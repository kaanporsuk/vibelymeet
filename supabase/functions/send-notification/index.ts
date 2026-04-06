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

// Map notification category → notify_* column (settings UI + DB). No entry = do not block on category toggles (e.g. safety_alerts).
const CATEGORY_TO_COLUMN: Record<string, string> = {
  new_message: 'notify_messages',
  voice_message: 'notify_messages',
  video_message: 'notify_messages',
  message_reaction: 'notify_messages',
  date_proposal_received: 'notify_messages',
  date_proposal_accepted: 'notify_messages',
  date_proposal_declined: 'notify_messages',
  messages: 'notify_messages',
  date_suggestion_proposed: 'notify_messages',
  date_suggestion_countered: 'notify_messages',
  date_suggestion_accepted: 'notify_messages',
  date_suggestion_declined: 'notify_messages',
  date_suggestion_cancelled: 'notify_messages',
  date_suggestion_expiring_soon: 'notify_messages',
  new_match: 'notify_new_match',
  mutual_vibe: 'notify_new_match',
  who_liked_you: 'notify_new_match',
  event_registered: 'notify_event_reminder',
  event_reminder_30m: 'notify_event_reminder',
  event_reminder_5m: 'notify_event_reminder',
  event_ended: 'notify_event_reminder',
  new_event_city: 'notify_event_reminder',
  event_almost_full: 'notify_event_reminder',
  event_waitlist_promoted: 'notify_event_reminder',
  event_reminder: 'notify_event_reminder',
  event_cancelled: 'notify_event_reminder',
  event_live: 'notify_event_live',
  daily_drop: 'notify_daily_drop',
  drop_opener: 'notify_daily_drop',
  drop_reply: 'notify_daily_drop',
  drop_expiring: 'notify_daily_drop',
  partner_ready: 'notify_ready_gate',
  date_starting: 'notify_ready_gate',
  reconnection: 'notify_ready_gate',
  ready_gate: 'notify_ready_gate',
  date_reminder: 'notify_date_reminder',
  vibe_received: 'notify_someone_vibed_you',
  super_vibe: 'notify_someone_vibed_you',
  someone_vibed_you: 'notify_someone_vibed_you',
  premium_teaser: 'notify_recommendations',
  re_engagement: 'notify_recommendations',
  weekly_summary: 'notify_recommendations',
  recommendations: 'notify_recommendations',
  product_updates: 'notify_product_updates',
  credits_subscription: 'notify_credits_subscription',
}

// Categories that bypass quiet hours (time-critical / safety / support)
const BYPASS_QUIET_HOURS = ['ready_gate', 'safety_alerts', 'safety', 'support_reply']

type AdmissionStatus = 'confirmed' | 'waitlisted' | string | undefined

function getEventId(data: any): string | null {
  return typeof data?.event_id === 'string' && data.event_id.trim() ? data.event_id : null
}

function getAdmissionStatus(data: any): AdmissionStatus {
  return typeof data?.admission_status === 'string' && data.admission_status.trim()
    ? data.admission_status
    : undefined
}

function isEventLifecycleCategory(category: string): boolean {
  return [
    'event_reminder',
    'event_reminder_30m',
    'event_reminder_5m',
    'event_waitlist_promoted',
    'event_live',
    'event_cancelled',
  ].includes(category)
}

function getSessionId(data: any): string | null {
  if (typeof data?.session_id === 'string' && data.session_id.trim()) return data.session_id
  if (typeof data?.video_session_id === 'string' && data.video_session_id.trim()) return data.video_session_id
  return null
}

function getQueueId(data: any): string | null {
  if (typeof data?.queue_id === 'string' && data.queue_id.trim()) return data.queue_id
  return null
}

function shouldLogLifecycle(category: string, data: any): boolean {
  return isEventLifecycleCategory(category) || !!getEventId(data) || !!getSessionId(data)
}

function logLifecycle(payload: {
  event_id?: string | null
  session_id?: string | null
  user_id?: string | null
  admission_status?: string | null
  queue_id?: string | null
  category?: string | null
  result: string
  error_reason?: string | null
}) {
  console.log('lifecycle.send_notification', JSON.stringify(payload))
}

function eventDeepLink(category: string, data: any): string | null {
  const eventId = getEventId(data)
  if (!eventId) return null

  const admissionStatus = getAdmissionStatus(data)
  const isConfirmed = admissionStatus === 'confirmed'

  if (category === 'event_live') {
    return `/event/${eventId}/lobby`
  }

  if (category === 'event_reminder' || category === 'event_reminder_30m' || category === 'event_reminder_5m') {
    return isConfirmed ? `/event/${eventId}/lobby` : `/events/${eventId}`
  }

  if (category === 'event_waitlist_promoted' || category === 'event_cancelled') {
    return `/events/${eventId}`
  }

  return null
}

// Title/body templates for P0 notification types (used when caller omits title or body)
const NOTIFICATION_TEMPLATES: Record<string, { title: string; body: (ctx: any) => string }> = {
  new_message: { title: 'New message', body: (ctx) => `${ctx?.senderName ?? 'Someone'}: ${ctx?.preview ?? 'New message'}` },
  new_match: { title: "It's a vibe! 💜", body: (ctx) => `You matched with ${ctx?.partnerName ?? 'someone'}` },
  daily_drop: { title: 'Daily Drop is ready 💧', body: () => 'Your daily match is waiting. Tap to reveal!' },
  drop_opener: { title: 'New opener received', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a message` },
  drop_reply: { title: 'Reply received!', body: (ctx) => `${ctx?.senderName ?? 'Someone'} replied to your opener` },
  event_reminder_30m: {
    title: 'Event in 30 minutes ⏰',
    body: (ctx) =>
      ctx?.admission_status === 'confirmed'
        ? `${ctx?.eventTitle ?? 'Your event'} starts soon. Get ready to join the lobby.`
        : `${ctx?.eventTitle ?? 'Your event'} starts soon. You’re still on the waitlist, so keep an eye on the event page for status updates.`,
  },
  event_reminder_5m: {
    title: 'Starting in 5 minutes! 🎉',
    body: (ctx) =>
      ctx?.admission_status === 'confirmed'
        ? `${ctx?.eventTitle ?? 'Your event'} is about to begin. Tap through to the lobby.`
        : `${ctx?.eventTitle ?? 'Your event'} is about to begin. You’re still on the waitlist, so keep an eye on the event page for status updates.`,
  },
  event_waitlist_promoted: {
    title: "You're in! 🎉",
    body: (ctx) => `A spot opened up — you're confirmed for ${ctx?.eventTitle ?? 'your event'}. Open the event page to view your updated status.`,
  },
  event_live: {
    title: 'Event is LIVE 🔴',
    body: (ctx) =>
      ctx?.admission_status === 'confirmed'
        ? `${ctx?.eventTitle ?? 'Event'} has started. Enter the lobby now!`
        : `${ctx?.eventTitle ?? 'Event'} has started. Open the event page to view your status.`,
  },
  event_cancelled: {
    title: 'Event cancelled',
    body: (ctx) => `${ctx?.eventTitle ?? 'An event'} has been cancelled. Open the event page for details.`,
  },
  vibe_received: { title: 'Someone vibed you! 💜', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a vibe at ${ctx?.eventTitle ?? 'an event'}` },
  super_vibe: { title: 'Super Vibe! ⭐', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent you a Super Vibe!` },
  mutual_vibe: { title: "It's a match! 🎉", body: (ctx) => `You and ${ctx?.partnerName ?? 'someone'} vibed each other` },
  partner_ready: { title: 'Your match is ready!', body: () => 'Tap to start your video date' },
  date_proposal_received: { title: 'Date suggestion 📅', body: (ctx) => `${ctx?.senderName ?? 'Someone'} suggested a date` },
  date_proposal_accepted: { title: 'Date accepted! 🎉', body: (ctx) => `${ctx?.partnerName ?? 'Someone'} accepted your date suggestion` },
  date_suggestion_proposed: { title: 'Date suggestion 📅', body: (ctx) => `${ctx?.senderName ?? 'Someone'} suggested a date` },
  date_suggestion_countered: { title: 'New counter proposal 📅', body: (ctx) => `${ctx?.senderName ?? 'Someone'} sent a counter` },
  date_suggestion_accepted: { title: 'Date accepted! 🎉', body: (ctx) => `${ctx?.senderName ?? 'Someone'} accepted your date suggestion` },
  date_suggestion_declined: { title: 'Date suggestion declined', body: (ctx) => `${ctx?.senderName ?? 'Someone'} declined` },
  date_suggestion_cancelled: { title: 'Date suggestion cancelled', body: (ctx) => `${ctx?.senderName ?? 'Someone'} cancelled the suggestion` },
  date_suggestion_expiring_soon: { title: 'Date suggestion expiring soon ⏳', body: () => 'Your date suggestion is about to expire. Open chat to respond.' },
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

/** Role claim from a JWT body (base64url). Edge `verify_jwt` already validated the signature. */
function jwtPayloadRole(token: string): string | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const mid = parts[1]
    const b64 = mid.replace(/-/g, "+").replace(/_/g, "/")
    const pad = (4 - (b64.length % 4)) % 4
    const json = JSON.parse(atob(b64 + "=".repeat(pad)))
    return typeof json?.role === "string" ? json.role : null
  } catch {
    return null
  }
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
  let lifecycleContext: {
    shouldLog: boolean
    event_id: string | null
    session_id: string | null
    user_id: string | null
    admission_status: string | null
    queue_id: string | null
    category: string | null
  } | null = null

  const emitLifecycle = (result: string, errorReason?: string | null) => {
    if (!lifecycleContext?.shouldLog) return
    logLifecycle({
      event_id: lifecycleContext.event_id,
      session_id: lifecycleContext.session_id,
      user_id: lifecycleContext.user_id,
      admission_status: lifecycleContext.admission_status,
      queue_id: lifecycleContext.queue_id,
      category: lifecycleContext.category,
      result,
      error_reason: errorReason ?? null,
    })
  }

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
    // String equality can fail across key rotations / API vs runtime representations; role claim is stable.
    const isServiceRole =
      token === serviceKey || jwtPayloadRole(token) === 'service_role'

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

    const requestBody = await req.json()
    const { user_id, category, data, image_url, bypass_preferences } = requestBody
    let { title, body } = requestBody

    lifecycleContext = {
      shouldLog: shouldLogLifecycle(typeof category === 'string' ? category : '', data),
      event_id: getEventId(data),
      session_id: getSessionId(data),
      user_id: typeof user_id === 'string' ? user_id : null,
      admission_status: typeof getAdmissionStatus(data) === 'string' ? getAdmissionStatus(data)! : null,
      queue_id: getQueueId(data),
      category: typeof category === 'string' ? category : null,
    }

    if (!user_id || !category) {
      emitLifecycle('rejected', 'invalid_request')
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
      emitLifecycle('suppressed', 'no_preferences')
      return new Response(JSON.stringify({ success: false, reason: 'no_preferences' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ━━━ SAFETY CONTRACT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // "Take a break" hides users from discovery but NEVER:
    //   - blocks safety_alerts notifications
    //   - prevents reports or blocks against this user
    //   - interferes with admin suspension/moderation
    //   - shields the user from any trust & safety action
    // The safety_alerts category ALWAYS bypasses pause gates.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Check account-level pause (legacy is_paused + account_paused)
    if (category !== 'safety_alerts' && category !== 'support_reply') {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('is_paused, paused_until, account_paused, account_paused_until')
        .eq('id', user_id)
        .maybeSingle()

      // Check legacy pause
      const legacyPaused = profileRow?.is_paused === true &&
        (profileRow.paused_until == null || new Date(profileRow.paused_until) > new Date())

      // Check new pause
      const accountPaused = profileRow?.account_paused === true &&
        (profileRow.account_paused_until == null || new Date(profileRow.account_paused_until) > new Date())

      if (legacyPaused || accountPaused) {
        await logNotification(user_id, category, title, body, data, false, 'account_paused')
        emitLifecycle('suppressed', 'account_paused')
        return new Response(JSON.stringify({ success: false, reason: 'account_paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 5. Check notification-prefs pause (paused_until on notification_preferences)
    if (category !== 'safety_alerts' && category !== 'support_reply' && prefs.paused_until) {
      if (new Date(prefs.paused_until) > new Date()) {
        await logNotification(user_id, category, title, body, data, false, 'paused')
        emitLifecycle('suppressed', 'paused')
        return new Response(JSON.stringify({ success: false, reason: 'paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 6. Check master toggle
    if (!prefs.push_enabled && !bypass_preferences) {
      await logNotification(user_id, category, title, body, data, false, 'user_disabled')
      emitLifecycle('suppressed', 'user_disabled')
      return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 7. Check category toggle (notify_* columns only — matches settings UI)
    if (category !== 'safety_alerts' && category !== 'support_reply') {
      const col = CATEGORY_TO_COLUMN[category]
      if (col && prefs[col] === false) {
        await logNotification(user_id, category, title, body, data, false, 'user_disabled')
        emitLifecycle('suppressed', 'user_disabled')
        return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const isDateSuggestionCategory =
      typeof category === 'string' && category.startsWith('date_suggestion_')

    // 8. Check per-match mute (messages, new_match, and date suggestion categories)
    if ((category === 'messages' || category === 'new_match' || isDateSuggestionCategory) && data?.match_id) {
      // Canonical per-match mute table.
      const { data: notifMute } = await supabase
        .from('match_notification_mutes')
        .select('id, muted_until')
        .eq('user_id', user_id)
        .eq('match_id', data.match_id)
        .maybeSingle()

      if (notifMute) {
        if (!notifMute.muted_until || new Date(notifMute.muted_until) > new Date()) {
          await logNotification(user_id, category, title, body, data, false, 'match_muted')
          emitLifecycle('suppressed', 'match_muted')
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
        emitLifecycle('suppressed', 'quiet_hours')
        return new Response(JSON.stringify({ success: false, reason: 'quiet_hours' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 9. Message bundling: collapse_id + optional multi-message copy (replaces per-minute throttle)
    let finalTitle = title
    let finalBody = body
    let collapseId: string | undefined
    if (category === 'messages' && prefs.message_bundle_enabled && data?.match_id) {
      // Per-recipient per-conversation; OneSignal collapse_id max 64 chars
      const raw = `msg_${data.match_id}_${user_id}`
      collapseId = raw.length <= 64 ? raw : raw.slice(0, 64)
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', data.match_id)
        .is('read_at', null)
        .neq('sender_id', user_id)

      const n = unreadCount ?? 0
      if (n > 1) {
        finalTitle = `${title} · ${n} messages`
        finalBody = `${n} new messages`
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
      emitLifecycle('suppressed', 'no_player_id')
      return new Response(JSON.stringify({ success: false, reason: 'no_player_id' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 11. Send via OneSignal (all registered devices)
    // Deep link contract (web + native):
    // - /chat/:id is always the other user's profile_id (the message sender from the recipient's POV).
    // - Persistent chat rows use `matches.id` as `match_id` in message bundles / client logic — not for the chat URL path.
    // - Event lobby / ready gate pushes may include `video_session_id` (= video_sessions.id). Legacy `match_id` in those
    //   payloads is the same session id during the compatibility window — not matches.id until post-date mutual / Daily Drop.
    let webPath = '/'
    const admissionStatus = getAdmissionStatus(data)
    const osData: Record<string, unknown> = { ...(data || {}), category }
    if (
      (category === 'messages' || isDateSuggestionCategory) &&
      data?.match_id &&
      data?.sender_id
    ) {
      const chatPath = `/chat/${data.sender_id}`
      osData.match_id = data.match_id
      osData.other_user_id = data.sender_id
      osData.sender_id = data.sender_id
      osData.url = chatPath
      osData.deep_link = chatPath
      webPath = chatPath
    } else {
      const eventLink = isEventLifecycleCategory(category) ? eventDeepLink(category, data) : null
      const deepLink =
        eventLink ||
        (data && typeof data.url === 'string'
          ? data.url
          : data && typeof data.deep_link === 'string'
            ? data.deep_link
            : '/')
      osData.deep_link = deepLink
      if (typeof admissionStatus === 'string') {
        osData.admission_status = admissionStatus
      }
      webPath = deepLink
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

    const osResultText = await osResponse.text()
    let notificationId: string | undefined
    try {
      const parsed = JSON.parse(osResultText) as { id?: string }
      notificationId = typeof parsed?.id === 'string' ? parsed.id : undefined
    } catch {
      /* non-JSON body */
    }
    console.log('OneSignal:', osResponse.status, notificationId || 'no-id')
    if (osResponse.ok) {
      emitLifecycle('delivered', null)
    } else {
      emitLifecycle('delivery_error', `onesignal_http_${osResponse.status}`)
    }

    // 12. Log success
    await logNotification(user_id, category, finalTitle, finalBody, data, true)

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    emitLifecycle('error', error?.message || 'internal_error')
    console.error('send-notification error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
