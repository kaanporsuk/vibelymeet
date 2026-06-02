export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type NotificationCategory =
  | 'ready_gate'
  | 'video_date'
  | 'event_live'
  | 'event_reminder'
  | 'new_match'
  | 'message'
  | 'daily_drop'
  | 'someone_vibed_you'
  | 'super_vibe'
  | 'verification'
  | 'credits_subscription'
  | 'system'
  | 'safety';

export type NotificationAction =
  | { kind: 'open_chat'; matchId?: string; userId?: string; otherUserId?: string }
  | { kind: 'open_event'; eventId: string }
  | { kind: 'open_event_lobby'; eventId: string }
  | { kind: 'open_ready_gate'; sessionId: string; eventId?: string }
  | { kind: 'open_video_date'; sessionId: string }
  | { kind: 'open_daily_drop'; dropId?: string }
  | { kind: 'open_profile'; userId: string }
  | { kind: 'open_credits' }
  | { kind: 'open_subscription' }
  | { kind: 'open_verification' }
  | { kind: 'open_notification_settings' }
  | { kind: 'none' };

export type UserNotificationRow = {
  id: string;
  user_id: string;
  category: NotificationCategory | string;
  title: string;
  body: string | null;
  priority: NotificationPriority;
  action: NotificationAction;
  data: Record<string, unknown>;
  actor_id: string | null;
  image_url: string | null;
  group_key: string | null;
  group_count: number;
  dedupe_key: string | null;
  seen_at: string | null;
  read_at: string | null;
  opened_at: string | null;
  dismissed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function stringProp(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export const SAFE_NOTIFICATION_ROUTE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export type NotificationRoutePlatform = 'any' | 'native' | 'web';

const UNIVERSAL_NOTIFICATION_STATIC_APP_PATHS = [
  '/',
  '/credits',
  '/daily-drop',
  '/events',
  '/matches',
  '/premium',
  '/profile',
  '/schedule',
  '/settings',
  '/settings/credits',
  '/settings/notifications',
] as const;

export const WEB_NOTIFICATION_STATIC_APP_PATHS = new Set([
  ...UNIVERSAL_NOTIFICATION_STATIC_APP_PATHS,
  '/dashboard',
  '/home',
]);

export const NATIVE_NOTIFICATION_STATIC_APP_PATHS = new Set([
  ...UNIVERSAL_NOTIFICATION_STATIC_APP_PATHS,
  '/(tabs)/profile',
]);

export const NOTIFICATION_STATIC_APP_PATHS = new Set([
  ...WEB_NOTIFICATION_STATIC_APP_PATHS,
  ...NATIVE_NOTIFICATION_STATIC_APP_PATHS,
]);

export const NOTIFICATION_DYNAMIC_SINGLE_SEGMENT_ROUTES = new Set(['chat', 'date', 'events', 'ready', 'user']);

export function normalizeNotificationRouteSegment(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  return SAFE_NOTIFICATION_ROUTE_SEGMENT.test(trimmed) ? encodeURIComponent(trimmed) : null;
}

function routeSegment(value: string | null | undefined): string | null {
  return normalizeNotificationRouteSegment(value);
}

function staticNotificationPathsForPlatform(platform: NotificationRoutePlatform): Set<string> {
  if (platform === 'web') return WEB_NOTIFICATION_STATIC_APP_PATHS;
  if (platform === 'native') return NATIVE_NOTIFICATION_STATIC_APP_PATHS;
  return NOTIFICATION_STATIC_APP_PATHS;
}

export function isAllowedNotificationAppPath(path: string, platform: NotificationRoutePlatform = 'any'): boolean {
  if (staticNotificationPathsForPlatform(platform).has(path)) return true;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 2 && NOTIFICATION_DYNAMIC_SINGLE_SEGMENT_ROUTES.has(segments[0])) {
    return normalizeNotificationRouteSegment(segments[1]) === segments[1];
  }
  if (segments.length === 3 && segments[0] === 'event' && segments[2] === 'lobby') {
    return normalizeNotificationRouteSegment(segments[1]) === segments[1];
  }
  if (segments.length === 3 && segments[0] === 'settings' && segments[1] === 'ticket') {
    return normalizeNotificationRouteSegment(segments[2]) === segments[2];
  }
  return false;
}

export function normalizeNotificationAppPath(
  rawPath: string,
  platform: NotificationRoutePlatform = 'any',
): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.includes('\\')) return null;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const [cleanPath] = path.split(/[?#]/);
  const appPath = cleanPath || '/';
  return isAllowedNotificationAppPath(appPath, platform) ? appPath : null;
}

export function isUrgentNotification(priority: string | null | undefined): boolean {
  return priority === 'urgent';
}

export function isExpiredNotification(row: Pick<UserNotificationRow, 'expires_at'>, nowMs = Date.now()): boolean {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() <= nowMs);
}

export function normalizeNotificationAction(value: unknown): NotificationAction {
  const kind = stringProp(value, 'kind');
  switch (kind) {
    case 'open_chat': {
      return {
        kind,
        matchId: stringProp(value, 'matchId') ?? stringProp(value, 'match_id') ?? undefined,
        userId: stringProp(value, 'userId') ?? stringProp(value, 'user_id') ?? undefined,
        otherUserId: stringProp(value, 'otherUserId') ?? stringProp(value, 'other_user_id') ?? undefined,
      };
    }
    case 'open_event': {
      const eventId = stringProp(value, 'eventId') ?? stringProp(value, 'event_id');
      return eventId ? { kind, eventId } : { kind: 'none' };
    }
    case 'open_event_lobby': {
      const eventId = stringProp(value, 'eventId') ?? stringProp(value, 'event_id');
      return eventId ? { kind, eventId } : { kind: 'none' };
    }
    case 'open_ready_gate': {
      const sessionId = stringProp(value, 'sessionId') ?? stringProp(value, 'session_id') ?? stringProp(value, 'video_session_id');
      const eventId = stringProp(value, 'eventId') ?? stringProp(value, 'event_id') ?? undefined;
      return sessionId ? { kind, sessionId, eventId } : { kind: 'none' };
    }
    case 'open_video_date': {
      const sessionId = stringProp(value, 'sessionId') ?? stringProp(value, 'session_id') ?? stringProp(value, 'video_session_id');
      return sessionId ? { kind, sessionId } : { kind: 'none' };
    }
    case 'open_daily_drop':
      return { kind, dropId: stringProp(value, 'dropId') ?? stringProp(value, 'drop_id') ?? undefined };
    case 'open_profile': {
      const userId = stringProp(value, 'userId') ?? stringProp(value, 'user_id') ?? stringProp(value, 'profile_id');
      return userId ? { kind, userId } : { kind: 'none' };
    }
    case 'open_credits':
    case 'open_subscription':
    case 'open_verification':
    case 'open_notification_settings':
      return { kind };
    default:
      return { kind: 'none' };
  }
}

export function resolveNotificationActionToWebRoute(actionInput: unknown): string | null {
  const action = normalizeNotificationAction(actionInput);
  switch (action.kind) {
    case 'open_chat': {
      const peerId = routeSegment(action.otherUserId ?? action.userId ?? action.matchId);
      return peerId ? `/chat/${peerId}` : null;
    }
    case 'open_event': {
      const eventId = routeSegment(action.eventId);
      return eventId ? `/events/${eventId}` : null;
    }
    case 'open_event_lobby': {
      const eventId = routeSegment(action.eventId);
      return eventId ? `/event/${eventId}/lobby` : null;
    }
    case 'open_ready_gate': {
      const sessionId = routeSegment(action.sessionId);
      return sessionId ? `/ready/${sessionId}` : null;
    }
    case 'open_video_date': {
      const sessionId = routeSegment(action.sessionId);
      return sessionId ? `/date/${sessionId}` : null;
    }
    case 'open_daily_drop':
      return '/matches';
    case 'open_profile': {
      const userId = routeSegment(action.userId);
      return userId ? `/user/${userId}` : null;
    }
    case 'open_credits':
      return '/credits';
    case 'open_subscription':
      return '/premium';
    case 'open_verification':
      return '/profile';
    case 'open_notification_settings':
      return '/settings';
    case 'none':
      return null;
  }
}

export function resolveNotificationActionToNativeRoute(actionInput: unknown): string | null {
  const action = normalizeNotificationAction(actionInput);
  switch (action.kind) {
    case 'open_chat': {
      const peerId = routeSegment(action.otherUserId ?? action.userId ?? action.matchId);
      return peerId ? `/chat/${peerId}` : null;
    }
    case 'open_event': {
      const eventId = routeSegment(action.eventId);
      return eventId ? `/events/${eventId}` : null;
    }
    case 'open_event_lobby': {
      const eventId = routeSegment(action.eventId);
      return eventId ? `/event/${eventId}/lobby` : null;
    }
    case 'open_ready_gate': {
      const sessionId = routeSegment(action.sessionId);
      return sessionId ? `/ready/${sessionId}` : null;
    }
    case 'open_video_date': {
      const sessionId = routeSegment(action.sessionId);
      return sessionId ? `/date/${sessionId}` : null;
    }
    case 'open_daily_drop':
      return '/daily-drop';
    case 'open_profile': {
      const userId = routeSegment(action.userId);
      return userId ? `/user/${userId}` : null;
    }
    case 'open_credits':
      return '/settings/credits';
    case 'open_subscription':
      return '/premium';
    case 'open_verification':
      return '/(tabs)/profile';
    case 'open_notification_settings':
      return '/settings/notifications';
    case 'none':
      return null;
  }
}
