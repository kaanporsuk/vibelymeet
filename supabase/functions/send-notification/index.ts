import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0'
import {
  enforceProviderRateLimit,
  fetchWithTimeout,
  providerFetchTimeoutMs,
  providerRateLimitConfig,
} from '../_shared/video-date-provider-reliability.ts'
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://www.vibelymeet.com'

/**
 * Map notification category → notify_* column (settings UI + DB).
 *
 * Known callers (repo audit) — every push category used in code should appear here or in CATEGORY_PREFERENCE_BYPASS:
 * - send-message, send-game-event → messages
 * - daily-room create_match_call → match_call
 * - swipe-actions → ready_gate, someone_vibed_you
 * - useEventVibes → mutual_vibe, someone_vibed_you
 * - post-date-verdict, daily-drop-actions (reply) → new_match
 * - post-date-verdict-reminders → post_date_feedback_reminder
 * - generate-daily-drops, daily-drop-actions (opener) → daily_drop
 * - date-suggestion-actions → date_suggestion_*
 * - date-suggestion-expiry → date_suggestion_expiring_soon
 * - event-reminders → event_reminder
 * - process-waitlist-promotion-notify-queue → event_waitlist_promoted
 * - date-reminder-cron → date_reminder
 * - stripe-webhook (credits pack) → credits_subscription
 * - send-support-reply → support_reply (bypass bucket prefs)
 * - AdminEventControls / AdminEventAttendeesModal → event_live, event_reminder
 * - adminEventCancellationNotify → event_cancelled
 * - PushPermissionPrompt → safety_alerts (bypass bucket prefs)
 *
 * Any category not listed in CATEGORY_TO_COLUMN and not in CATEGORY_PREFERENCE_BYPASS is rejected (fail closed)
 * so users cannot receive pushes that ignore their per-bucket toggles.
 */
const CATEGORY_TO_COLUMN: Record<string, string> = {
  new_message: 'notify_messages',
  voice_message: 'notify_messages',
  video_message: 'notify_messages',
  message_reaction: 'notify_messages',
  date_proposal_received: 'notify_messages',
  date_proposal_accepted: 'notify_messages',
  date_proposal_declined: 'notify_messages',
  messages: 'notify_messages',
  /** Incoming voice/video chat calls — separate bucket so users can silence DM pushes but keep call alerts (or vice versa). */
  match_call: 'notify_match_calls',
  date_suggestion_proposed: 'notify_messages',
  date_suggestion_countered: 'notify_messages',
  date_suggestion_accepted: 'notify_messages',
  date_suggestion_declined: 'notify_messages',
  date_suggestion_cancelled: 'notify_messages',
  date_suggestion_schedule_share_updated: 'notify_messages',
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
  post_date_feedback_reminder: 'notify_date_reminder',
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

/** Skip per-bucket notify_* checks (and use the same set for pause bypasses below). Trust & safety + support only. */
const CATEGORY_PREFERENCE_BYPASS: Record<string, true> = {
  safety_alerts: true,
  support_reply: true,
}

function skipsPerBucketPreferenceCheck(category: string): boolean {
  return CATEGORY_PREFERENCE_BYPASS[category] === true
}

type NotificationChannel = 'in_app' | 'push'
type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

const DEFAULT_CHANNELS: NotificationChannel[] = ['in_app', 'push']

function normalizeChannels(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value)) return DEFAULT_CHANNELS
  const channels = value.filter((item): item is NotificationChannel => item === 'in_app' || item === 'push')
  return channels.length > 0 ? Array.from(new Set(channels)) : DEFAULT_CHANNELS
}

function normalizeInboxCategory(category: string): string {
  if (category === 'messages' || category === 'new_message' || category === 'voice_message' || category === 'video_message' || category === 'message_reaction' || category === 'match_call') {
    return 'message'
  }
  if (category === 'mutual_vibe' || category === 'new_match' || category === 'who_liked_you') return 'new_match'
  if (category === 'vibe_received' || category === 'someone_vibed_you') return 'someone_vibed_you'
  if (category === 'partner_ready' || category === 'ready_gate') return 'ready_gate'
  if (category === 'date_starting' || category === 'reconnection' || category === 'date_reminder' || category === 'post_date_feedback_reminder') return 'video_date'
  if (category === 'event_live') return 'event_live'
  if (isEventLifecycleCategory(category) || category === 'event_registered' || category === 'event_ended' || category === 'new_event_city' || category === 'event_almost_full') return 'event_reminder'
  if (category === 'daily_drop' || category === 'drop_opener' || category === 'drop_reply' || category === 'drop_expiring') return 'daily_drop'
  if (category === 'super_vibe') return 'super_vibe'
  if (category === 'credits_subscription') return 'credits_subscription'
  if (category === 'safety' || category === 'safety_alerts') return 'safety'
  if (category === 'support_reply' || category === 'product_updates' || category === 'welcome' || category === 'profile_incomplete') return 'system'
  if (category.startsWith('date_suggestion_') || category.startsWith('date_proposal_')) return 'message'
  return 'system'
}

function validProviderIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null
}

function priorityForInbox(category: string, requested: unknown): NotificationPriority {
  if (requested === 'low' || requested === 'normal' || requested === 'high' || requested === 'urgent') return requested
  if (category === 'ready_gate' || category === 'partner_ready' || category === 'date_starting' || category === 'reconnection' || category === 'match_call') return 'urgent'
  if (category === 'event_live' || category === 'new_match' || category === 'mutual_vibe' || category === 'daily_drop' || category === 'drop_expiring' || category === 'super_vibe') return 'high'
  if (category === 'safety' || category === 'safety_alerts') return 'high'
  return 'normal'
}

function actionObject(kind: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, ...fields }
}

function normalizeActionFromRequest(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const kind = (value as Record<string, unknown>).kind
  if (typeof kind !== 'string' || kind.trim().length === 0) return null
  return value as Record<string, unknown>
}

function deriveNotificationAction(category: string, data: any, webPath?: string | null): Record<string, unknown> {
  if ((category === 'messages' || category === 'new_message' || category === 'voice_message' || category === 'video_message' || category === 'message_reaction' || category === 'match_call' || category.startsWith('date_suggestion_') || category.startsWith('date_proposal_')) && (data?.match_id || data?.sender_id || data?.other_user_id)) {
    return actionObject('open_chat', {
      matchId: data?.match_id,
      userId: data?.sender_id ?? data?.other_user_id,
      otherUserId: data?.sender_id ?? data?.other_user_id,
    })
  }
  if (category === 'new_match' || category === 'mutual_vibe') {
    return actionObject('open_chat', {
      matchId: data?.match_id,
      userId: data?.other_user_id ?? data?.partner_id ?? data?.sender_id,
      otherUserId: data?.other_user_id ?? data?.partner_id ?? data?.sender_id,
    })
  }
  if (category === 'event_live' && getEventId(data)) {
    return actionObject('open_event_lobby', { eventId: getEventId(data) })
  }
  if (isEventLifecycleCategory(category) && getEventId(data)) {
    return actionObject(category === 'event_live' ? 'open_event_lobby' : 'open_event', { eventId: getEventId(data) })
  }
  if ((category === 'ready_gate' || category === 'partner_ready') && getSessionId(data)) {
    return actionObject('open_ready_gate', { sessionId: getSessionId(data), eventId: getEventId(data) ?? undefined })
  }
  if ((category === 'date_starting' || category === 'reconnection' || category === 'date_reminder') && getSessionId(data)) {
    return actionObject('open_video_date', { sessionId: getSessionId(data) })
  }
  if (category === 'daily_drop' || category === 'drop_opener' || category === 'drop_reply' || category === 'drop_expiring') {
    return actionObject('open_daily_drop', { dropId: data?.drop_id })
  }
  if (category === 'credits_subscription') return actionObject('open_credits')
  if (category === 'support_reply' && typeof data?.ticket_id === 'string') {
    return actionObject('none', { url: `/settings/ticket/${data.ticket_id}` })
  }
  if (category === 'profile_incomplete') return actionObject('open_profile', { userId: data?.user_id })
  if (webPath && webPath.startsWith('/settings')) return actionObject('open_notification_settings')
  return actionObject('none')
}

function pathFromAction(action: Record<string, unknown>): string | null {
  const kind = typeof action.kind === 'string' ? action.kind : 'none'
  const eventId = typeof action.eventId === 'string' ? action.eventId : typeof action.event_id === 'string' ? action.event_id : null
  const sessionId =
    typeof action.sessionId === 'string'
      ? action.sessionId
      : typeof action.session_id === 'string'
        ? action.session_id
        : typeof action.video_session_id === 'string'
          ? action.video_session_id
          : null
  const peerId =
    typeof action.otherUserId === 'string'
      ? action.otherUserId
      : typeof action.userId === 'string'
        ? action.userId
        : typeof action.matchId === 'string'
          ? action.matchId
          : null
  switch (kind) {
    case 'open_chat':
      return peerId ? `/chat/${peerId}` : null
    case 'open_event':
      return eventId ? `/events/${eventId}` : null
    case 'open_event_lobby':
      return eventId ? `/event/${eventId}/lobby` : null
    case 'open_ready_gate':
      return sessionId ? `/ready/${sessionId}` : null
    case 'open_video_date':
      return sessionId ? `/date/${sessionId}` : null
    case 'open_daily_drop':
      return '/matches'
    case 'open_profile':
      return typeof action.userId === 'string' ? `/user/${action.userId}` : '/profile'
    case 'open_credits':
      return '/credits'
    case 'open_subscription':
      return '/premium'
    case 'open_verification':
      return '/profile'
    case 'open_notification_settings':
      return '/settings'
    default:
      return typeof action.url === 'string' && action.url.startsWith('/') ? action.url : null
  }
}

function defaultInboxDedupeKey(category: string, data: any): string | null {
  if ((category === 'messages' || category === 'new_message' || category === 'voice_message' || category === 'video_message' || category === 'message_reaction' || category === 'match_call' || category.startsWith('date_suggestion_') || category.startsWith('date_proposal_')) && data?.match_id) {
    return `message:${data.match_id}`
  }
  if ((category === 'new_match' || category === 'mutual_vibe') && data?.match_id) return `new_match:${data.match_id}`
  if ((category === 'ready_gate' || category === 'partner_ready' || category === 'date_starting' || category === 'reconnection') && getSessionId(data)) {
    return `${normalizeInboxCategory(category)}:${getSessionId(data)}`
  }
  if (isEventLifecycleCategory(category) && getEventId(data)) {
    return `${normalizeInboxCategory(category)}:${category}:${getEventId(data)}`
  }
  if ((category === 'daily_drop' || category === 'drop_opener' || category === 'drop_reply' || category === 'drop_expiring') && (data?.drop_id || data?.drop_date)) {
    return `daily_drop:${data.drop_id ?? data.drop_date}`
  }
  if (category === 'support_reply' && data?.ticket_id) return `support_reply:${data.ticket_id}`
  return null
}

function defaultInboxGroupKey(category: string, data: any): string | null {
  if ((category === 'messages' || category === 'new_message' || category === 'voice_message' || category === 'video_message' || category === 'message_reaction' || category === 'match_call') && data?.match_id) {
    return `message:${data.match_id}`
  }
  if (isEventLifecycleCategory(category) && getEventId(data)) return `event:${getEventId(data)}`
  if ((category === 'ready_gate' || category === 'partner_ready' || category === 'date_starting' || category === 'reconnection') && getSessionId(data)) return `session:${getSessionId(data)}`
  return null
}

// Categories that bypass quiet hours (time-critical / safety / support)
const BYPASS_QUIET_HOURS = [
  'ready_gate',
  'partner_ready',
  'date_starting',
  'reconnection',
  'safety_alerts',
  'safety',
  'support_reply',
  'match_call',
]

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

function isVideoDatePushPayloadCategory(category: string): boolean {
  return category === 'ready_gate' ||
    category === 'partner_ready' ||
    category === 'date_starting' ||
    category === 'reconnection' ||
    category === 'date_reminder' ||
    category === 'post_date_feedback_reminder'
}

async function isClientFeatureFlagEnabled(flag: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('evaluate_client_feature_flag', {
      p_flag: flag,
      p_user: userId,
    })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

function safePayloadString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function jsonByteLength(value: unknown): number {
  const text = JSON.stringify(value)
  return new TextEncoder().encode(text).length
}

const ONESIGNAL_DATA_MAX_BYTES = 2048
const VIDEO_DATE_PRELOAD_DATA_MAX_BYTES = 3 * 1024

function createCorrelationId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

function sanitizeDispatchPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]/g, '_') || 'unknown'
}

function createNotificationDispatchGroupId(args: {
  recipientId: string
  category: string
  sessionId?: string | null
  eventId?: string | null
  dedupeKey?: string | null
}): string {
  const target = args.dedupeKey || args.sessionId || args.eventId || 'global'
  return [
    'vd4',
    sanitizeDispatchPart(args.recipientId),
    sanitizeDispatchPart(args.category),
    sanitizeDispatchPart(target),
  ].join(':').slice(0, 160)
}

function nestedDispatchGroupId(data: Record<string, unknown>): string | null {
  const preload = data.video_date_preload && typeof data.video_date_preload === 'object'
    ? data.video_date_preload as Record<string, unknown>
    : null
  return safePayloadString(data.dispatch_group_id) ?? safePayloadString(preload?.dispatchGroupId) ?? safePayloadString(preload?.dispatch_group_id)
}

function attachVideoDateOneSignalContract(args: {
  category: string
  recipientId: string
  data: any
  osData: Record<string, unknown>
  notificationId?: string | null
  dedupeKey?: string | null
  deepLink?: string | null
}): Record<string, unknown> {
  if (!isVideoDatePushPayloadCategory(args.category)) return args.osData
  const next: Record<string, unknown> = { ...args.osData, category: args.category }
  const notificationId = safePayloadString(args.notificationId)
  const dedupeKey = safePayloadString(args.dedupeKey) ?? safePayloadString(args.data?.dedupe_key) ?? safePayloadString(args.data?.dedupeKey)
  const sessionId =
    getSessionId(next) ??
    getSessionId(args.data) ??
    safePayloadString(next.video_session_id)
  const eventId =
    getEventId(next) ??
    getEventId(args.data) ??
    safePayloadString(next.eventId) ??
    safePayloadString(args.data?.eventId)
  const deepLink = safePayloadString(next.deep_link) ?? safePayloadString(next.url) ?? safePayloadString(args.deepLink)
  const dispatchGroupId = nestedDispatchGroupId(next) ?? (
    dedupeKey
      ? createNotificationDispatchGroupId({
          recipientId: args.recipientId,
          category: args.category,
          sessionId,
          eventId,
          dedupeKey,
        })
      : null
  )

  if (notificationId) next.notification_id = notificationId
  if (dedupeKey) next.dedupe_key = dedupeKey
  if (dispatchGroupId) next.dispatch_group_id = dispatchGroupId
  if (deepLink) {
    next.deep_link = deepLink
    if (!safePayloadString(next.url)) next.url = deepLink
  }
  if (sessionId) next.video_session_id = sessionId
  if (eventId) next.event_id = eventId

  return next
}

async function videoDatePartnerThumbUrl(session: any, recipientId: string): Promise<string | null> {
  const partnerId =
    session?.participant_1_id === recipientId
      ? session?.participant_2_id
      : session?.participant_2_id === recipientId
        ? session?.participant_1_id
        : null
  if (!partnerId) return null
  const { data } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', partnerId)
    .maybeSingle()
  return safePayloadString((data as { avatar_url?: unknown } | null)?.avatar_url, 700)
}

function videoDatePushPhaseTimes(session: any): {
  state: string
  phaseStartedAtMs: number | null
  phaseDeadlineAtMs: number | null
} {
  const state =
    session?.ended_at || session?.state === 'ended' || session?.phase === 'ended'
      ? 'ended'
      : session?.date_started_at || session?.state === 'date' || session?.phase === 'date'
        ? 'date'
        : session?.handshake_started_at || session?.state === 'handshake' || session?.phase === 'handshake'
          ? 'handshake'
          : 'ready_gate'
  if (state === 'date') {
    const startedAtMs = parseIsoMs(session?.date_started_at)
    const extraSeconds =
      typeof session?.date_extra_seconds === 'number' && Number.isFinite(session.date_extra_seconds)
        ? Math.max(0, Math.floor(session.date_extra_seconds))
        : 0
    return {
      state,
      phaseStartedAtMs: startedAtMs,
      phaseDeadlineAtMs: startedAtMs == null ? null : startedAtMs + (300 + extraSeconds) * 1000,
    }
  }
  if (state === 'handshake') {
    const startedAtMs = parseIsoMs(session?.handshake_started_at)
    return {
      state,
      phaseStartedAtMs: startedAtMs,
      phaseDeadlineAtMs: startedAtMs == null ? null : startedAtMs + 60_000,
    }
  }
  return {
    state,
    phaseStartedAtMs: null,
    phaseDeadlineAtMs: parseIsoMs(session?.ready_gate_expires_at),
  }
}

async function buildVideoDatePushPayloadV2(args: {
  category: string
  recipientId: string
  data: any
  dedupeKey?: string | null
  pushPayloadV2Enabled: boolean
  multiDeviceDedupV2Enabled: boolean
}): Promise<Record<string, unknown>> {
  if (!args.pushPayloadV2Enabled && !args.multiDeviceDedupV2Enabled) return {}
  if (!isVideoDatePushPayloadCategory(args.category)) return {}
  const sessionId = getSessionId(args.data)
  if (!sessionId) return {}
  const correlationId = createCorrelationId()
  const dispatchGroupId = args.multiDeviceDedupV2Enabled
    ? createNotificationDispatchGroupId({
        recipientId: args.recipientId,
        category: args.category,
        sessionId,
        eventId: getEventId(args.data),
        dedupeKey: args.dedupeKey ?? correlationId,
      })
    : null

  const { data: session } = await supabase
    .from('video_sessions')
    .select('id, event_id, participant_1_id, participant_2_id, state, phase, ended_at, handshake_started_at, date_started_at, date_extra_seconds, ready_gate_expires_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) {
    return {
      correlation_id: correlationId,
      dispatch_group_id: dispatchGroupId,
    }
  }
  if (session.participant_1_id !== args.recipientId && session.participant_2_id !== args.recipientId) {
    return {
      correlation_id: correlationId,
      dispatch_group_id: dispatchGroupId,
    }
  }

  if (!args.pushPayloadV2Enabled) {
    return dispatchGroupId
      ? { correlation_id: correlationId, dispatch_group_id: dispatchGroupId }
      : { correlation_id: correlationId }
  }

  const times = videoDatePushPhaseTimes(session)
  const eventId = safePayloadString(session.event_id) ?? getEventId(args.data)
  const partnerThumbUrl = await videoDatePartnerThumbUrl(session, args.recipientId)
  const serverNowMs = Date.now()
  const preload = {
    schema: 'video_date_push_preload_v2',
    sessionId,
    eventId,
    state: times.state,
    phaseDeadlineAtMs: times.phaseDeadlineAtMs,
    phaseStartedAtMs: times.phaseStartedAtMs,
    clockSkewHintMs: 0,
    partnerThumbUrl,
    correlationId,
    dispatchGroupId,
    serverNowMs,
  }
  const payload: Record<string, unknown> = {
    video_date_preload: preload,
    phaseDeadlineAt: times.phaseDeadlineAtMs,
    state: times.state,
    clockSkewHintMs: 0,
    partnerThumbUrl,
    eventId,
    correlation_id: correlationId,
  }
  if (dispatchGroupId) payload.dispatch_group_id = dispatchGroupId
  if (jsonByteLength(payload) <= VIDEO_DATE_PRELOAD_DATA_MAX_BYTES) return payload
  preload.partnerThumbUrl = null
  payload.partnerThumbUrl = null
  if (jsonByteLength(payload) <= ONESIGNAL_DATA_MAX_BYTES) return payload
  preload.phaseStartedAtMs = null
  return payload
}

function compactVideoDateOsDataForPush(osData: Record<string, unknown>): Record<string, unknown> {
  if (!osData.video_date_preload || jsonByteLength(osData) <= ONESIGNAL_DATA_MAX_BYTES) return osData
  const preload = osData.video_date_preload && typeof osData.video_date_preload === 'object'
    ? osData.video_date_preload as Record<string, unknown>
    : null
  const withoutThumb: Record<string, unknown> = {
    ...osData,
    partnerThumbUrl: null,
    video_date_preload: preload ? { ...preload, partnerThumbUrl: null } : osData.video_date_preload,
  }
  if (jsonByteLength(withoutThumb) <= ONESIGNAL_DATA_MAX_BYTES) return withoutThumb
  const withoutStartedAt: Record<string, unknown> = {
    ...withoutThumb,
    video_date_preload: preload ? {
      ...preload,
      partnerThumbUrl: null,
      phaseStartedAtMs: null,
    } : withoutThumb.video_date_preload,
  }
  if (jsonByteLength(withoutStartedAt) <= ONESIGNAL_DATA_MAX_BYTES) return withoutStartedAt

  const minimal: Record<string, unknown> = {}
  for (const key of [
    'category',
    'action',
    'notification_id',
    'dedupe_key',
    'dispatch_group_id',
    'deep_link',
    'url',
    'video_session_id',
    'event_id',
    'correlation_id',
    'admission_status',
  ]) {
    if (osData[key] != null) minimal[key] = osData[key]
  }
  const minimalPreload: Record<string, unknown> = {}
  if (preload) {
    for (const key of [
      'schema',
      'sessionId',
      'eventId',
      'state',
      'phaseDeadlineAtMs',
      'correlationId',
      'dispatchGroupId',
      'serverNowMs',
    ]) {
      if (preload[key] != null) minimalPreload[key] = preload[key]
    }
    if (!minimal.video_session_id && typeof preload.sessionId === 'string') minimal.video_session_id = preload.sessionId
    if (!minimal.event_id && typeof preload.eventId === 'string') minimal.event_id = preload.eventId
    if (!minimal.dispatch_group_id && typeof preload.dispatchGroupId === 'string') minimal.dispatch_group_id = preload.dispatchGroupId
    if (!minimal.correlation_id && typeof preload.correlationId === 'string') minimal.correlation_id = preload.correlationId
    if (Object.keys(minimalPreload).length > 0) {
      const withMinimalPreload = { ...minimal, video_date_preload: minimalPreload }
      if (jsonByteLength(withMinimalPreload) <= ONESIGNAL_DATA_MAX_BYTES) return withMinimalPreload
    }
  }
  if (jsonByteLength(minimal) <= ONESIGNAL_DATA_MAX_BYTES) return minimal
  return minimal
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function firstPayloadUuid(data: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = data?.[key]
    if (isUuid(value)) return value.trim()
  }
  return null
}

async function otherParticipantFromMatch(matchId: string, recipientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('matches')
    .select('profile_id_1, profile_id_2')
    .eq('id', matchId)
    .maybeSingle()

  if (!data) return null
  if (data.profile_id_1 === recipientId) return data.profile_id_2
  if (data.profile_id_2 === recipientId) return data.profile_id_1
  return null
}

async function otherParticipantFromVideoSession(sessionId: string, recipientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('video_sessions')
    .select('participant_1_id, participant_2_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!data) return null
  if (data.participant_1_id === recipientId) return data.participant_2_id
  if (data.participant_2_id === recipientId) return data.participant_1_id
  return null
}

function isVideoDatePairNotificationCategory(category: string): boolean {
  return isVideoDatePushPayloadCategory(category)
}

async function resolveActorId(recipientId: string, category: string, data: any): Promise<string | null> {
  const directActor = firstPayloadUuid(data, [
    'sender_id',
    'actor_id',
    'from_user_id',
    'profile_id',
    'other_user_id',
  ])
  if (directActor && directActor !== recipientId) return directActor

  const matchId = firstPayloadUuid(data, ['match_id'])
  if (
    matchId &&
    (category === 'messages' ||
      category === 'match_call' ||
      category === 'new_match' ||
      category === 'date_reminder' ||
      category.startsWith('date_suggestion_'))
  ) {
    const peer = await otherParticipantFromMatch(matchId, recipientId)
    if (peer && peer !== recipientId) return peer
  }

  const sessionId = firstPayloadUuid(data, ['video_session_id', 'session_id'])
    ?? (category === 'ready_gate' ? firstPayloadUuid(data, ['match_id']) : null)
  if (sessionId && isVideoDatePairNotificationCategory(category)) {
    const peer = await otherParticipantFromVideoSession(sessionId, recipientId)
    if (peer && peer !== recipientId) return peer
  }

  return null
}

async function isPairBlocked(userA: string, userB: string): Promise<boolean> {
  const { data: blockA, error: blockAError } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', userA)
    .eq('blocked_id', userB)
    .limit(1)

  if (blockAError) throw blockAError
  if (Array.isArray(blockA) && blockA.length > 0) return true

  const { data: blockB, error: blockBError } = await supabase
    .from('blocked_users')
    .select('id')
    .eq('blocker_id', userB)
    .eq('blocked_id', userA)
    .limit(1)

  if (blockBError) throw blockBError
  return Array.isArray(blockB) && blockB.length > 0
}

async function isPairReported(userA: string, userB: string): Promise<boolean> {
  const { data: reportA, error: reportAError } = await supabase
    .from('user_reports')
    .select('id')
    .eq('reporter_id', userA)
    .eq('reported_id', userB)
    .limit(1)

  if (reportAError) throw reportAError
  if (Array.isArray(reportA) && reportA.length > 0) return true

  const { data: reportB, error: reportBError } = await supabase
    .from('user_reports')
    .select('id')
    .eq('reporter_id', userB)
    .eq('reported_id', userA)
    .limit(1)

  if (reportBError) throw reportBError
  return Array.isArray(reportB) && reportB.length > 0
}

async function unsafeNotificationPairReason(userA: string, userB: string): Promise<'blocked_pair' | 'reported_pair' | null> {
  if (await isPairBlocked(userA, userB)) return 'blocked_pair'
  if (await isPairReported(userA, userB)) return 'reported_pair'
  return null
}

async function validateClientNotificationRequest(
  authUserId: string | null,
  recipientId: string,
  category: string,
  data: any,
): Promise<string | null> {
  if (!authUserId) return 'missing_auth_user'

  // Browser push setup sends a self-addressed confirmation after the OS/browser grant.
  if (category === 'safety_alerts' && recipientId === authUserId) {
    return null
  }

  const actorId = firstPayloadUuid(data, ['actor_id', 'sender_id', 'from_user_id'])
  if (actorId !== authUserId) return 'actor_mismatch'

  const clientVibeCategories = new Set(['someone_vibed_you', 'vibe_received', 'mutual_vibe', 'super_vibe'])
  const eventId = getEventId(data)
  if (!clientVibeCategories.has(category) || !eventId || recipientId === authUserId) {
    return 'client_category_not_allowed'
  }

  const { data: sentVibe, error: sentVibeError } = await supabase
    .from('event_vibes')
    .select('id')
    .eq('event_id', eventId)
    .eq('sender_id', authUserId)
    .eq('receiver_id', recipientId)
    .maybeSingle()
  if (sentVibeError) throw sentVibeError
  if (!sentVibe?.id) return 'event_vibe_missing'

  if (category === 'mutual_vibe') {
    const { data: reciprocalVibe, error: reciprocalVibeError } = await supabase
      .from('event_vibes')
      .select('id')
      .eq('event_id', eventId)
      .eq('sender_id', recipientId)
      .eq('receiver_id', authUserId)
      .maybeSingle()
    if (reciprocalVibeError) throw reciprocalVibeError
    if (!reciprocalVibe?.id) return 'mutual_vibe_missing'
  }

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

/**
 * OneSignal sometimes returns HTTP 200 with a JSON body that still reports send failures
 * (e.g. invalid_player_ids, non-empty errors array). Only treat as failure when the body
 * clearly indicates provider-side error — do not guess on ambiguous shapes.
 */
function onesignalJsonIndicatesLogicalFailure(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (typeof p.id === 'string' && p.id.length === 0) {
    return 'onesignal_empty_notification_id'
  }
  const err = p.errors
  if (Array.isArray(err) && err.length > 0) {
    return 'onesignal_errors_array'
  }
  if (err && typeof err === 'object' && !Array.isArray(err) && Object.keys(err as Record<string, unknown>).length > 0) {
    return 'onesignal_errors_object'
  }
  return null
}

const CANONICAL_APP_ORIGIN = 'https://www.vibelymeet.com'
const NON_CANONICAL_APEX_ORIGIN = CANONICAL_APP_ORIGIN.replace('://www.', '://')

type PushPlatform = 'web' | 'mobile'
type ProviderStatus = 'not_attempted' | 'accepted' | 'failed' | 'logical_error'
type DeepLinkRouteClass = 'chat' | 'event' | 'date' | 'matches' | 'profile' | 'settings' | 'unknown'
type DeepLinkUrlKind =
  | 'missing'
  | 'relative_app_path'
  | 'canonical_www_url'
  | 'non_canonical_apex_url'
  | 'external_url'
  | 'invalid_url'

type PushDeliveryDiagnostic = {
  notification_category: string
  platform_targeted: PushPlatform[]
  web_player_present: boolean
  web_player_subscribed: boolean
  mobile_player_present: boolean
  mobile_player_subscribed: boolean
  player_target_count: number
  subscription_table_target_count: number
  suppression_reason: string | null
  suppression_gate: string | null
  preference_column: string | null
  provider_request_attempted: boolean
  provider_status: ProviderStatus
  provider_http_status: number | null
  provider_error_code: string | null
  provider_notification_id: string | null
  provider_response_body_snippet: string | null
  provider_response_content_type: string | null
  provider_accepted_at: string | null
  deeplink_url_present: boolean
  deeplink_url_kind: DeepLinkUrlKind
  deeplink_route_class: DeepLinkRouteClass
  canonical_origin_valid: boolean
  // Compatibility aliases for the existing push-health audit assertions and support queries.
  web_player_id_present: boolean
  web_subscribed: boolean
  mobile_player_id_present: boolean
  mobile_subscribed: boolean
  push_enabled: boolean | null
}

function routeClassForPath(path: string): DeepLinkRouteClass {
  const cleanPath = path.split(/[?#]/)[0] || '/'
  if (cleanPath.startsWith('/chat/')) return 'chat'
  if (cleanPath.startsWith('/event/') || cleanPath.startsWith('/events/')) return 'event'
  if (cleanPath.startsWith('/date/') || cleanPath.startsWith('/ready/')) return 'date'
  if (cleanPath === '/matches' || cleanPath.startsWith('/matches/')) return 'matches'
  if (cleanPath === '/profile' || cleanPath.startsWith('/profile/')) return 'profile'
  if (cleanPath === '/settings' || cleanPath.startsWith('/settings/')) return 'settings'
  return 'unknown'
}

function classifyDeepLink(raw: unknown): {
  deeplink_url_present: boolean
  deeplink_url_kind: DeepLinkUrlKind
  deeplink_route_class: DeepLinkRouteClass
  canonical_origin_valid: boolean
} {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) {
    return {
      deeplink_url_present: false,
      deeplink_url_kind: 'missing',
      deeplink_route_class: 'unknown',
      canonical_origin_valid: false,
    }
  }

  if (value.startsWith('/')) {
    return {
      deeplink_url_present: true,
      deeplink_url_kind: 'relative_app_path',
      deeplink_route_class: routeClassForPath(value),
      canonical_origin_valid: true,
    }
  }

  try {
    const url = new URL(value)
    if (url.origin === CANONICAL_APP_ORIGIN) {
      return {
        deeplink_url_present: true,
        deeplink_url_kind: 'canonical_www_url',
        deeplink_route_class: routeClassForPath(url.pathname),
        canonical_origin_valid: true,
      }
    }
    if (url.origin === NON_CANONICAL_APEX_ORIGIN) {
      return {
        deeplink_url_present: true,
        deeplink_url_kind: 'non_canonical_apex_url',
        deeplink_route_class: routeClassForPath(url.pathname),
        canonical_origin_valid: false,
      }
    }
    return {
      deeplink_url_present: true,
      deeplink_url_kind: 'external_url',
      deeplink_route_class: routeClassForPath(url.pathname),
      canonical_origin_valid: false,
    }
  } catch {
    return {
      deeplink_url_present: true,
      deeplink_url_kind: 'invalid_url',
      deeplink_route_class: 'unknown',
      canonical_origin_valid: false,
    }
  }
}

function diagnosticDeepLinkCandidate(category: string, data: any): unknown {
  const isDateSuggestionCategory = typeof category === 'string' && category.startsWith('date_suggestion_')
  if (
    (category === 'match_call' || category === 'messages' || isDateSuggestionCategory) &&
    data?.match_id &&
    data?.sender_id
  ) {
    return `/chat/${data.sender_id}`
  }
  const eventLink = isEventLifecycleCategory(category) ? eventDeepLink(category, data) : null
  if (eventLink) return eventLink
  if (data && typeof data.url === 'string') return data.url
  if (data && typeof data.deep_link === 'string') return data.deep_link
  return null
}

function redactedProviderResponseSnippet(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[uuid]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[token]')
    .slice(0, 500)
}

function buildPushDeliveryDiagnostic(args: {
  category: string
  data: any
  prefs?: any | null
  suppressionReason?: string | null
  suppressionGate?: string | null
  preferenceColumn?: string | null
  providerRequestAttempted?: boolean
  providerStatus?: ProviderStatus
  providerHttpStatus?: number | null
  providerErrorCode?: string | null
  providerNotificationId?: string | null
  providerResponseBodySnippet?: string | null
  providerResponseContentType?: string | null
  providerAcceptedAt?: string | null
  deepLink?: unknown
  subscriptionTargetCount?: number | null
  subscriptionTableTargetCount?: number | null
}): PushDeliveryDiagnostic {
  const prefs = args.prefs ?? null
  const webPlayerPresent = Boolean(prefs?.onesignal_player_id)
  const webPlayerSubscribed = prefs?.onesignal_subscribed === true
  const mobilePlayerPresent = Boolean(prefs?.mobile_onesignal_player_id)
  const mobilePlayerSubscribed = prefs?.mobile_onesignal_subscribed === true
  const platformTargeted: PushPlatform[] = []
  if (webPlayerPresent && webPlayerSubscribed) platformTargeted.push('web')
  if (mobilePlayerPresent && mobilePlayerSubscribed) platformTargeted.push('mobile')
  const playerTargetCount = typeof args.subscriptionTargetCount === 'number'
    ? args.subscriptionTargetCount
    : platformTargeted.length
  const deepLink = classifyDeepLink(args.deepLink ?? diagnosticDeepLinkCandidate(args.category, args.data))

  return {
    notification_category: args.category,
    platform_targeted: platformTargeted,
    web_player_present: webPlayerPresent,
    web_player_subscribed: webPlayerSubscribed,
    mobile_player_present: mobilePlayerPresent,
    mobile_player_subscribed: mobilePlayerSubscribed,
    player_target_count: playerTargetCount,
    subscription_table_target_count: args.subscriptionTableTargetCount ?? 0,
    suppression_reason: args.suppressionReason ?? null,
    suppression_gate: args.suppressionGate ?? null,
    preference_column: args.preferenceColumn ?? null,
    provider_request_attempted: args.providerRequestAttempted === true,
    provider_status: args.providerStatus ?? 'not_attempted',
    provider_http_status: args.providerHttpStatus ?? null,
    provider_error_code: args.providerErrorCode ?? null,
    provider_notification_id: args.providerNotificationId ?? null,
    provider_response_body_snippet: args.providerResponseBodySnippet ?? null,
    provider_response_content_type: args.providerResponseContentType ?? null,
    provider_accepted_at: args.providerAcceptedAt ?? null,
    ...deepLink,
    web_player_id_present: webPlayerPresent,
    web_subscribed: webPlayerSubscribed,
    mobile_player_id_present: mobilePlayerPresent,
    mobile_subscribed: mobilePlayerSubscribed,
    push_enabled: prefs == null ? null : prefs.push_enabled !== false,
  }
}

function dataWithPushDiagnostic(data: any, diagnostic: PushDeliveryDiagnostic): Record<string, unknown> {
  const base = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>) }
    : {}
  return {
    ...base,
    push_delivery_diagnostic: diagnostic,
  }
}

function addOneSignalSubscriptionId(ids: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const id = value.trim()
  if (id) ids.add(id)
}

function isMissingPushSubscriptionsRelation(error: any): boolean {
  const haystack = `${error?.code ?? ''} ${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`
  return /42P01|PGRST205|push_subscriptions|relation .* does not exist|Could not find the table/i.test(haystack)
}

async function collectOneSignalSubscriptionIds(userId: string, prefs: any): Promise<{
  ids: string[]
  subscriptionTableTargetCount: number
}> {
  const ids = new Set<string>()

  // Compatibility: legacy column names still contain OneSignal subscription IDs.
  if (prefs.onesignal_subscribed) {
    addOneSignalSubscriptionId(ids, prefs.onesignal_player_id)
  }
  if (prefs.mobile_onesignal_subscribed) {
    addOneSignalSubscriptionId(ids, prefs.mobile_onesignal_player_id)
  }

  let subscriptionTableTargetCount = 0
  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('subscription_id')
      .eq('user_id', userId)
      .eq('provider', 'onesignal')
      .eq('subscribed', true)

    if (error) {
      if (!isMissingPushSubscriptionsRelation(error)) {
        console.warn('push_subscriptions lookup failed:', error.message)
      }
      return { ids: Array.from(ids), subscriptionTableTargetCount }
    }

    for (const row of data ?? []) {
      const before = ids.size
      addOneSignalSubscriptionId(ids, (row as { subscription_id?: unknown }).subscription_id)
      if (ids.size > before) subscriptionTableTargetCount += 1
    }
  } catch (error) {
    if (!isMissingPushSubscriptionsRelation(error)) {
      console.warn('push_subscriptions lookup exception:', error)
    }
  }

  return { ids: Array.from(ids), subscriptionTableTargetCount }
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
  date_suggestion_schedule_share_updated: { title: 'Schedule updated', body: (ctx) => `${ctx?.senderName ?? 'Someone'} updated shared date blocks` },
  date_suggestion_expiring_soon: { title: 'Date suggestion expiring soon ⏳', body: () => 'Your date suggestion is about to expire. Open chat to respond.' },
  post_date_feedback_reminder: {
    title: 'Your video date is waiting for your feedback.',
    body: () => 'Share your post-date vibe to finish the flow.',
  },
  match_call: { title: 'Incoming call', body: () => 'Open the app to answer' },
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
  suppressedReason?: string,
  diagnostic?: PushDeliveryDiagnostic
) {
  await supabase.from('notification_log').insert({
    user_id: userId,
    category,
    title,
    body,
    data: diagnostic ? dataWithPushDiagnostic(data, diagnostic) : data,
    delivered,
    suppressed_reason: suppressedReason || null,
  })
}

async function createOrUpdateUserNotification(args: {
  userId: string
  category: string
  title: string
  body: string
  data: any
  action: Record<string, unknown>
  priority: NotificationPriority
  imageUrl?: string | null
  actorId?: string | null
  dedupeKey?: string | null
  groupKey?: string | null
  expiresAt?: string | null
}) {
  const normalizedCategory = normalizeInboxCategory(args.category)
  const safeData = args.data && typeof args.data === 'object' && !Array.isArray(args.data)
    ? args.data
    : {}
  const dedupeKey = args.dedupeKey ?? defaultInboxDedupeKey(args.category, safeData)
  const groupKey = args.groupKey ?? defaultInboxGroupKey(args.category, safeData)
  const nowIso = new Date().toISOString()

  if (dedupeKey) {
    const { data: existing } = await supabase
      .from('user_notifications')
      .select('id, group_count')
      .eq('user_id', args.userId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()

    if (existing?.id) {
      const shouldIncrementGroup = groupKey != null && normalizedCategory === 'message'
      const nextCount = shouldIncrementGroup ? Math.max(1, Number(existing.group_count ?? 1) + 1) : Math.max(1, Number(existing.group_count ?? 1))
      const { data: updated, error } = await supabase
        .from('user_notifications')
        .update({
          category: normalizedCategory,
          title: args.title,
          body: args.body,
          priority: args.priority,
          action: args.action,
          data: safeData,
          actor_id: args.actorId ?? null,
          image_url: args.imageUrl ?? null,
          group_key: groupKey,
          group_count: nextCount,
          seen_at: null,
          read_at: null,
          opened_at: null,
          dismissed_at: null,
          expires_at: args.expiresAt ?? null,
          created_at: nowIso,
        })
        .eq('id', existing.id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      return updated?.id ?? existing.id
    }
  }

  const { data: inserted, error } = await supabase
    .from('user_notifications')
    .insert({
      user_id: args.userId,
      category: normalizedCategory,
      title: args.title,
      body: args.body,
      priority: args.priority,
      action: args.action,
      data: safeData,
      actor_id: args.actorId ?? null,
      image_url: args.imageUrl ?? null,
      group_key: groupKey,
      group_count: 1,
      dedupe_key: dedupeKey,
      expires_at: args.expiresAt ?? null,
    })
    .select('id')
    .maybeSingle()
  if (error) throw error
  return inserted?.id ?? null
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

  if (req.method === 'OPTIONS') return preflightResponse(req)
  const corsHeaders = corsHeadersForRequest(req)
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { error: 'origin_not_allowed' }, { status: 403 })
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
    let authUserId: string | null = null

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
      authUserId = claims.claims.sub
    }

    const requestBody = await req.json()
    let {
      user_id,
      category,
    } = requestBody
    const {
      image_url,
      bypass_preferences,
      action,
      priority,
      dedupe_key,
      group_key,
      expires_at,
      actor_id,
      provider_idempotency_key,
    } = requestBody
    const data = requestBody.data && typeof requestBody.data === 'object' && !Array.isArray(requestBody.data)
      ? requestBody.data
      : {}
    let { title, body } = requestBody
    const channels = normalizeChannels(requestBody.channels)
    const wantsInApp = channels.includes('in_app')
    const wantsPush = channels.includes('push')
    const requestedAction = normalizeActionFromRequest(action)
    const requestDedupeKey = typeof dedupe_key === 'string' && dedupe_key.trim() ? dedupe_key.trim() : null
    const requestProviderIdempotencyKey = validProviderIdempotencyKey(provider_idempotency_key)
    let inAppNotificationId: string | null = null
    let resolvedActorId: string | null = typeof actor_id === 'string' && actor_id.trim() ? actor_id.trim() : null

    lifecycleContext = {
      shouldLog: shouldLogLifecycle(typeof category === 'string' ? category : '', data),
      event_id: getEventId(data),
      session_id: getSessionId(data),
      user_id: typeof user_id === 'string' ? user_id : null,
      admission_status: typeof getAdmissionStatus(data) === 'string' ? getAdmissionStatus(data)! : null,
      queue_id: getQueueId(data),
      category: typeof category === 'string' ? category : null,
    }

    if (typeof user_id !== 'string' || !user_id.trim() || typeof category !== 'string' || !category.trim()) {
      emitLifecycle('rejected', 'invalid_request')
      return new Response(
        JSON.stringify({ success: false, error: 'user_id and category required' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    user_id = user_id.trim()
    category = category.trim()

    if (!isServiceRole) {
      const clientValidationError = await validateClientNotificationRequest(authUserId, user_id, category, data)
      if (clientValidationError) {
        emitLifecycle('rejected', clientValidationError)
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden', reason: clientValidationError }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    // Apply templates when title or body not provided
    const template = NOTIFICATION_TEMPLATES[category]
    if (template) {
      if (!title || typeof title !== 'string') title = template.title
      if (!body || typeof body !== 'string') body = template.body(data || {})
    }
    if (!title) title = 'Notification'
    if (!body) body = 'You have a new notification'

    let prefs: any | null = null
    const diagnostic = (overrides: {
      suppressionReason?: string | null
      suppressionGate?: string | null
      preferenceColumn?: string | null
      providerRequestAttempted?: boolean
      providerStatus?: ProviderStatus
      providerHttpStatus?: number | null
      providerErrorCode?: string | null
      providerNotificationId?: string | null
      providerResponseBodySnippet?: string | null
      providerResponseContentType?: string | null
      providerAcceptedAt?: string | null
      deepLink?: unknown
      subscriptionTargetCount?: number | null
      subscriptionTableTargetCount?: number | null
    }) => buildPushDeliveryDiagnostic({
      category,
      data,
      prefs,
      ...overrides,
    })

    const ensureInAppNotification = async (
      notificationTitle: string,
      notificationBody: string,
      deepLink?: string | null,
    ) => {
      if (!wantsInApp || inAppNotificationId) return inAppNotificationId
      try {
        if (!resolvedActorId) {
          resolvedActorId = await resolveActorId(user_id, category, data)
        }
        const notificationAction = requestedAction ?? deriveNotificationAction(category, data, deepLink)
        inAppNotificationId = await createOrUpdateUserNotification({
          userId: user_id,
          category,
          title: notificationTitle,
          body: notificationBody,
          data,
          action: notificationAction,
          priority: priorityForInbox(category, priority),
          imageUrl: typeof image_url === 'string' ? image_url : null,
          actorId: resolvedActorId,
          dedupeKey: requestDedupeKey,
          groupKey: typeof group_key === 'string' && group_key.trim() ? group_key.trim() : null,
          expiresAt: typeof expires_at === 'string' && expires_at.trim() ? expires_at.trim() : null,
        })
      } catch (error) {
        console.error('user_notification_upsert_failed:', error instanceof Error ? error.message : String(error))
      }
      return inAppNotificationId
    }

    if (!skipsPerBucketPreferenceCheck(category)) {
      const actorId = resolvedActorId ?? await resolveActorId(user_id, category, data)
      resolvedActorId = actorId
      const pairSafetyReason = actorId ? await unsafeNotificationPairReason(user_id, actorId) : null
      if (actorId && pairSafetyReason) {
        console.log('send_notification_suppressed_unsafe_pair', JSON.stringify({
          user_id,
          actor_id: actorId,
          category,
          match_id: data?.match_id ?? null,
          session_id: getSessionId(data),
          reason: pairSafetyReason,
        }))
        await logNotification(user_id, category, title, body, data, false, pairSafetyReason, diagnostic({
          suppressionReason: pairSafetyReason,
          suppressionGate: pairSafetyReason,
        }))
        emitLifecycle('suppressed', pairSafetyReason)
        return new Response(JSON.stringify({ success: false, reason: pairSafetyReason, code: `suppressed_${pairSafetyReason}` }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // Fetch preferences
    const { data: existingPrefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()
    prefs = existingPrefs

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
      await logNotification(user_id, category, title, body, data, false, 'no_preferences', diagnostic({
        suppressionReason: 'no_preferences',
        suppressionGate: 'no_preferences',
      }))
      await ensureInAppNotification(title, body)
      if (!wantsPush) {
        emitLifecycle('in_app_only', 'no_preferences')
        return new Response(JSON.stringify({ success: true, in_app_notification_id: inAppNotificationId, push_skipped: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
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
    if (!skipsPerBucketPreferenceCheck(category)) {
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
        await logNotification(user_id, category, title, body, data, false, 'account_paused', diagnostic({
          suppressionReason: 'account_paused',
          suppressionGate: 'account_pause',
        }))
        emitLifecycle('suppressed', 'account_paused')
        return new Response(JSON.stringify({ success: false, reason: 'account_paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 5. Check notification-prefs pause (paused_until on notification_preferences)
    if (wantsPush && !skipsPerBucketPreferenceCheck(category) && prefs.paused_until) {
      if (new Date(prefs.paused_until) > new Date()) {
        await logNotification(user_id, category, title, body, data, false, 'paused', diagnostic({
          suppressionReason: 'paused',
          suppressionGate: 'notification_pause',
        }))
        await ensureInAppNotification(title, body)
        emitLifecycle('suppressed', 'paused')
        return new Response(JSON.stringify({ success: false, reason: 'paused' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 6. Check master toggle
    if (wantsPush && !prefs.push_enabled && !bypass_preferences) {
      await logNotification(user_id, category, title, body, data, false, 'user_disabled', diagnostic({
        suppressionReason: 'user_disabled',
        suppressionGate: 'master_push_disabled',
      }))
      await ensureInAppNotification(title, body)
      emitLifecycle('suppressed', 'user_disabled')
      return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 7. Check category toggle (notify_* columns only — matches settings UI)
    if (wantsPush && !skipsPerBucketPreferenceCheck(category)) {
      const col = CATEGORY_TO_COLUMN[category]
      if (!col) {
        await logNotification(user_id, category, title, body, data, false, 'unknown_category', diagnostic({
          suppressionReason: 'unknown_category',
          suppressionGate: 'unknown_category',
        }))
        await ensureInAppNotification(title, body)
        emitLifecycle('suppressed', 'unknown_category')
        return new Response(JSON.stringify({ success: false, reason: 'unknown_category', in_app_notification_id: inAppNotificationId }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      if (prefs[col] === false) {
        await logNotification(user_id, category, title, body, data, false, 'user_disabled', diagnostic({
          suppressionReason: 'user_disabled',
          suppressionGate: 'category_disabled',
          preferenceColumn: col,
        }))
        await ensureInAppNotification(title, body)
        emitLifecycle('suppressed', 'user_disabled')
        return new Response(JSON.stringify({ success: false, reason: 'user_disabled' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const isDateSuggestionCategory =
      typeof category === 'string' && category.startsWith('date_suggestion_')

    // 8. Check per-match mute (messages, new_match, and date suggestion categories)
    if ((category === 'messages' || category === 'match_call' || category === 'new_match' || isDateSuggestionCategory) && data?.match_id) {
      // Canonical per-match mute table.
      const { data: notifMute } = await supabase
        .from('match_notification_mutes')
        .select('id, muted_until')
        .eq('user_id', user_id)
        .eq('match_id', data.match_id)
        .maybeSingle()

      if (notifMute) {
        if (!notifMute.muted_until || new Date(notifMute.muted_until) > new Date()) {
          await logNotification(user_id, category, title, body, data, false, 'match_muted', diagnostic({
            suppressionReason: 'match_muted',
            suppressionGate: 'match_muted',
          }))
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
    if (wantsPush && prefs.quiet_hours_enabled && !BYPASS_QUIET_HOURS.includes(category)) {
      const inQuiet = isInQuietHours(
        prefs.quiet_hours_start || '22:00',
        prefs.quiet_hours_end || '08:00',
        prefs.quiet_hours_timezone || 'UTC'
      )
      if (inQuiet) {
        await logNotification(user_id, category, title, body, data, false, 'quiet_hours', diagnostic({
          suppressionReason: 'quiet_hours',
          suppressionGate: 'quiet_hours',
        }))
        await ensureInAppNotification(title, body)
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

    await ensureInAppNotification(finalTitle, finalBody)
    if (!wantsPush) {
      emitLifecycle('in_app_only', null)
      return new Response(JSON.stringify({ success: true, in_app_notification_id: inAppNotificationId, push_skipped: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 10. Collect all stored OneSignal subscription IDs (legacy column names use "player_id").
    const {
      ids: playerIds,
      subscriptionTableTargetCount,
    } = await collectOneSignalSubscriptionIds(user_id, prefs)
    if (playerIds.length === 0) {
      await logNotification(user_id, category, title, body, data, false, 'no_player_id', diagnostic({
        suppressionReason: 'no_player_id',
        suppressionGate: 'no_player_id',
        subscriptionTargetCount: 0,
        subscriptionTableTargetCount,
      }))
      await ensureInAppNotification(finalTitle, finalBody)
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
    const [pushPayloadV2Enabled, multiDeviceDedupV2Enabled] = await Promise.all([
      isClientFeatureFlagEnabled('video_date.push_payload_v2', user_id),
      isClientFeatureFlagEnabled('video_date.multi_device_dedup_v2', user_id),
    ])
    const phase4PushData = await buildVideoDatePushPayloadV2({
      category,
      recipientId: user_id,
      data,
      dedupeKey: requestDedupeKey,
      pushPayloadV2Enabled,
      multiDeviceDedupV2Enabled,
    })
    let osData: Record<string, unknown> = { ...(data || {}), ...phase4PushData, category }
    const baseAction = requestedAction ?? deriveNotificationAction(category, data)
    osData.action = baseAction
    if (
      category === 'match_call' &&
      data?.match_id &&
      data?.sender_id
    ) {
      const chatPath = `/chat/${data.sender_id}`
      osData.match_id = data.match_id
      osData.other_user_id = data.sender_id
      osData.sender_id = data.sender_id
      if (typeof data.call_id === 'string' && data.call_id.trim()) osData.call_id = data.call_id.trim()
      if (typeof data.call_type === 'string' && data.call_type.trim()) osData.call_type = data.call_type.trim()
      osData.url = chatPath
      osData.deep_link = chatPath
      webPath = chatPath
    } else if (
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
      const actionLink = pathFromAction(baseAction)
      const deepLink =
        eventLink ||
        actionLink ||
        (data && typeof data.url === 'string'
          ? data.url
          : data && typeof data.deep_link === 'string'
            ? data.deep_link
            : '/')
      osData.deep_link = deepLink
      osData.url = deepLink
      if (typeof admissionStatus === 'string') {
        osData.admission_status = admissionStatus
      }
      webPath = deepLink
    }

    osData = attachVideoDateOneSignalContract({
      category,
      data,
      osData,
      recipientId: user_id,
      notificationId: inAppNotificationId,
      dedupeKey: requestDedupeKey,
      deepLink: webPath,
    })
    osData = compactVideoDateOsDataForPush(osData)
    if (multiDeviceDedupV2Enabled && !collapseId && typeof osData.dispatch_group_id === 'string' && osData.dispatch_group_id.trim()) {
      collapseId = osData.dispatch_group_id.trim().slice(0, 64)
    }

    const osPayload: any = {
      app_id: ONESIGNAL_APP_ID,
      include_subscription_ids: playerIds,
      target_channel: 'push',
      headings: { en: finalTitle },
      contents: { en: finalBody },
      data: osData,
      url: webPath !== '/' ? `${APP_URL}${webPath}` : APP_URL,
    }

    if (category === 'match_call') {
      osPayload.priority = 10
    }

    if (collapseId) {
      osPayload.collapse_id = collapseId
    }

    if (requestProviderIdempotencyKey) {
      osPayload.idempotency_key = requestProviderIdempotencyKey
    }

    if (image_url) {
      osPayload.chrome_web_image = image_url
    }

    let osResponse: Response
    let osResultText = ''
    let osResponseContentType: string | null = null
    try {
      await enforceProviderRateLimit(supabase, providerRateLimitConfig('onesignal', 'notification_create'))
      osResponse = await fetchWithTimeout('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(osPayload),
      }, {
        provider: 'onesignal',
        operation: 'notification_create',
        timeoutMs: providerFetchTimeoutMs('onesignal', 'notification_create'),
      })
      osResponseContentType = osResponse.headers.get('content-type')
      osResultText = await osResponse.text()
    } catch (error) {
      const suppressed = 'onesignal_exception'
      emitLifecycle('delivery_error', suppressed)
      await logNotification(user_id, category, finalTitle, finalBody, data, false, suppressed, diagnostic({
        suppressionReason: suppressed,
        suppressionGate: 'provider_failure',
        providerRequestAttempted: true,
        providerStatus: 'failed',
        providerErrorCode: suppressed,
        deepLink: webPath,
        subscriptionTargetCount: playerIds.length,
        subscriptionTableTargetCount,
      }))
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'onesignal_error',
          onesignal_reason: suppressed,
          detail: error instanceof Error ? error.message : String(error),
          status: error instanceof Error && error.name === 'ProviderRateLimitError' ? 429 : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    let notificationId: string | undefined
    let osParsed: unknown = null
    try {
      osParsed = JSON.parse(osResultText)
      const p = osParsed as { id?: string }
      notificationId = typeof p?.id === 'string' && p.id.length > 0 ? p.id : undefined
    } catch {
      /* non-JSON body */
    }
    console.log('OneSignal:', osResponse.status, notificationId || 'no-id')
    if (!osResponse.ok) {
      const errSnippet =
        osResultText.length > 280 ? `${osResultText.slice(0, 280)}…` : osResultText
      const providerSnippet = redactedProviderResponseSnippet(osResultText)
      const suppressed = `onesignal_http_${osResponse.status}`
      emitLifecycle('delivery_error', suppressed)
      await logNotification(user_id, category, finalTitle, finalBody, data, false, suppressed, diagnostic({
        suppressionReason: suppressed,
        suppressionGate: 'provider_failure',
        providerRequestAttempted: true,
        providerStatus: 'failed',
        providerHttpStatus: osResponse.status,
        providerErrorCode: suppressed,
        providerResponseBodySnippet: providerSnippet,
        providerResponseContentType: osResponseContentType,
        deepLink: webPath,
        subscriptionTargetCount: playerIds.length,
        subscriptionTableTargetCount,
      }))
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'onesignal_error',
          status: osResponse.status,
          detail: errSnippet || undefined,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const osLogicalFailure = onesignalJsonIndicatesLogicalFailure(osParsed)
    if (osLogicalFailure) {
      const errSnippet =
        osResultText.length > 280 ? `${osResultText.slice(0, 280)}…` : osResultText
      const providerSnippet = redactedProviderResponseSnippet(osResultText)
      emitLifecycle('delivery_error', osLogicalFailure)
      await logNotification(user_id, category, finalTitle, finalBody, data, false, osLogicalFailure, diagnostic({
        suppressionReason: osLogicalFailure,
        suppressionGate: 'provider_failure',
        providerRequestAttempted: true,
        providerStatus: 'logical_error',
        providerHttpStatus: osResponse.status,
        providerErrorCode: osLogicalFailure,
        providerResponseBodySnippet: providerSnippet,
        providerResponseContentType: osResponseContentType,
        deepLink: webPath,
        subscriptionTargetCount: playerIds.length,
        subscriptionTableTargetCount,
      }))
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'onesignal_error',
          onesignal_reason: osLogicalFailure,
          status: osResponse.status,
          detail: errSnippet || undefined,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    emitLifecycle('delivered', null)
    const acceptedAt = new Date().toISOString()
    await logNotification(user_id, category, finalTitle, finalBody, data, true, undefined, diagnostic({
      providerRequestAttempted: true,
      providerStatus: 'accepted',
      providerHttpStatus: osResponse.status,
      providerNotificationId: notificationId ?? null,
      providerResponseBodySnippet: redactedProviderResponseSnippet(osResultText),
      providerResponseContentType: osResponseContentType,
      providerAcceptedAt: acceptedAt,
      deepLink: webPath,
      subscriptionTargetCount: playerIds.length,
      subscriptionTableTargetCount,
    }))

    return new Response(
      JSON.stringify({ success: true, onesignal_id: notificationId ?? null, in_app_notification_id: inAppNotificationId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitLifecycle('error', message || 'internal_error')
    console.error('send-notification error:', error)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
