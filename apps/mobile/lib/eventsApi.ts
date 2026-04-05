import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import type { DrainMatchQueueResult, SwipeSessionStageResult } from '@shared/matching/videoSessionFlow';
import type { SelectedCity } from '@/components/events/EventFilterSheet';
import { normalizeContractError, toError } from '@/lib/contractErrors';
import {
  parseEventAttendeePreviewRows,
  parseEventDeckProfiles,
  type EventAttendeePreview as PreviewRevealedAttendee,
  type EventDeckProfile as DeckProfile,
} from '@shared/eventProfileAdapters';

const GRACE_HOURS = 6;

function getEventEndTime(event_date: string, duration_minutes?: number | null): Date {
  const start = new Date(event_date);
  const duration = duration_minutes ?? 60;
  return new Date(start.getTime() + duration * 60 * 1000);
}

function isEventVisible(event: {
  event_date: string;
  duration_minutes?: number | null;
  status?: string | null;
}): boolean {
  if (event.status === 'cancelled' || event.status === 'draft') return false;
  const graceEnd = new Date(
    getEventEndTime(event.event_date, event.duration_minutes).getTime() + GRACE_HOURS * 60 * 60 * 1000
  );
  return graceEnd > new Date();
}

/** Web parity: "Sat, Mar 22" */
function formatEventDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Web parity: "8:00 PM" */
function formatEventTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  cover_image: string;
  event_date: string;
  current_attendees: number | null;
  tags: string[] | null;
  status: string | null;
  duration_minutes: number | null;
  max_attendees: number | null;
  language?: string | null;
};

export type EventListItem = {
  id: string;
  title: string;
  description: string | null;
  image: string;
  date: string;
  time: string;
  attendees: number;
  tags: string[];
  status: string;
  eventDate: Date;
  duration_minutes: number;
  language?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  scope?: string | null;
};

/** Row shape from get_visible_events RPC (web parity). */
type VisibleEventRpcRow = {
  id: string;
  title: string;
  description: string | null;
  cover_image: string;
  event_date: string;
  duration_minutes: number;
  max_attendees: number;
  current_attendees: number;
  tags: string[] | null;
  status: string;
  computed_status?: string | null;
  scope?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  language?: string | null;
};

function visibleRpcRowToListItem(row: VisibleEventRpcRow): EventListItem {
  const eventDate = new Date(row.event_date);
  const durationMs = (row.duration_minutes || 60) * 60 * 1000;
  const now = new Date();
  const isLive = now >= eventDate && now < new Date(eventDate.getTime() + durationMs);
  const rawStatus = row.computed_status ?? row.status ?? 'upcoming';
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    image: row.cover_image,
    date: formatEventDate(eventDate),
    time: formatEventTime(eventDate),
    attendees: row.current_attendees ?? 0,
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: isLive ? 'live' : rawStatus,
    eventDate,
    duration_minutes: row.duration_minutes ?? 60,
    language: row.language ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    scope: row.scope ?? null,
  };
}

export type DiscoverEventsParams = {
  locationMode: 'nearby' | 'city';
  selectedCity: SelectedCity | null;
  distanceKm: number;
  deviceCoords: { lat: number; lng: number } | null;
  /** When false, city browse coordinates are not sent (server also enforces subscription). */
  canCityBrowse: boolean;
};

/**
 * Same RPC as web `useVisibleEvents` — premium browse + radius enforced server-side.
 */
export async function fetchVisibleEventsList(
  viewerProfileId: string,
  discover?: DiscoverEventsParams,
): Promise<EventListItem[]> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('location_data')
    .eq('id', viewerProfileId)
    .maybeSingle();
  if (profileError && __DEV__) {
    console.warn('[eventsApi] profile location fetch failed:', profileError.message);
  }
  const loc = profile?.location_data as { lat?: number; lng?: number } | null;

  const d = discover;
  const mode = !d?.canCityBrowse ? 'nearby' : (d.locationMode ?? 'nearby');
  const deviceLat = d?.deviceCoords?.lat ?? null;
  const deviceLng = d?.deviceCoords?.lng ?? null;
  const p_user_lat = (deviceLat ?? loc?.lat) ?? undefined;
  const p_user_lng = (deviceLng ?? loc?.lng) ?? undefined;

  let p_browse_lat: number | null = null;
  let p_browse_lng: number | null = null;
  if (mode === 'city' && d?.canCityBrowse && d.selectedCity) {
    p_browse_lat = d.selectedCity.lat;
    p_browse_lng = d.selectedCity.lng;
  }

  const hasRefPoint =
    (mode === 'city' && !!d?.selectedCity && !!d?.canCityBrowse) ||
    (mode === 'nearby' && p_user_lat != null && p_user_lng != null);

  const filterKm = d?.distanceKm ?? 50;
  const p_filter_radius_km =
    hasRefPoint && filterKm > 0
      ? mode === 'city' && (!d?.selectedCity || !d?.canCityBrowse)
        ? null
        : filterKm
      : null;

  const { data, error } = await supabase.rpc('get_visible_events', {
    p_user_id: viewerProfileId,
    p_user_lat: p_user_lat ?? null,
    p_user_lng: p_user_lng ?? null,
    p_is_premium: false,
    p_browse_lat,
    p_browse_lng,
    p_filter_radius_km,
  });
  if (error) {
    throw toError(normalizeContractError(error, 'events_visible_fetch_failed', 'Could not load events right now.'));
  }
  const rows = (data ?? []) as VisibleEventRpcRow[];
  return rows
    .map(visibleRpcRowToListItem)
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
}

/**
 * Discover events list — `get_visible_events` with location/radius (web parity).
 */
export function useDiscoverEvents(
  viewerProfileId: string | null | undefined,
  params: DiscoverEventsParams,
) {
  return useQuery({
    queryKey: [
      'events-discover',
      viewerProfileId,
      params.canCityBrowse,
      params.locationMode,
      params.selectedCity?.lat,
      params.selectedCity?.lng,
      params.distanceKm,
      params.deviceCoords?.lat,
      params.deviceCoords?.lng,
    ],
    queryFn: () => fetchVisibleEventsList(viewerProfileId!, params),
    enabled: !!viewerProfileId,
  });
}

/** Dashboard / simple callers: nearby list via RPC (profile location + default radius). */
export function useEvents(viewerProfileId: string | null | undefined, canCityBrowse: boolean) {
  return useDiscoverEvents(viewerProfileId, {
    locationMode: 'nearby',
    selectedCity: null,
    distanceKm: 50,
    deviceCoords: null,
    canCityBrowse: !!canCityBrowse,
  });
}

export type EventDetailsRow = EventRow & {
  location_name?: string | null;
  location_address?: string | null;
  is_location_specific?: boolean | null;
  price_amount?: number | null;
  max_attendees?: number | null;
  max_male_attendees?: number | null;
  max_female_attendees?: number | null;
  vibes?: string[] | null;
  is_free?: boolean | null;
  visibility?: string | null;
  language?: string | null;
};

export function useEventDetails(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-details', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      if (!eventId) return null;
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .maybeSingle();
      if (error) {
        throw toError(normalizeContractError(error, 'event_details_fetch_failed', 'Could not load event details.'));
      }
      return data as EventDetailsRow | null;
    },
  });
}

/** All event IDs the current user is registered for (Discover / lists should exclude these). */
export function useRegisteredEventIds(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['user-registered-event-ids', userId],
    enabled: !!userId,
    queryFn: async (): Promise<string[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('event_registrations')
        .select('event_id')
        .eq('profile_id', userId);
      if (error) {
        throw toError(normalizeContractError(error, 'registered_event_ids_fetch_failed', 'Could not load registrations.'));
      }
      return (data ?? []).map((r) => r.event_id).filter(Boolean) as string[];
    },
  });
}

/** Upcoming events the user is registered for — invite sheet event picker (not ended). */
export type InviteSheetEventRow = {
  id: string;
  title: string;
  cover_url?: string;
  start_time: string;
  city?: string;
};

export function useRegisteredUpcomingEventsForInvite(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['registered-upcoming-events-invite', userId],
    enabled: !!userId,
    queryFn: async (): Promise<InviteSheetEventRow[]> => {
      if (!userId) return [];
      const now = new Date();
      const { data: regRows, error: regError } = await supabase
        .from('event_registrations')
        .select('event_id')
        .eq('profile_id', userId);
      if (regError) throw regError;
      const eventIds = (regRows ?? []).map((r) => r.event_id).filter(Boolean) as string[];
      if (eventIds.length === 0) return [];

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, title, cover_image, event_date, duration_minutes, status, location_name')
        .in('id', eventIds)
        .order('event_date', { ascending: true });
      if (eventsError) throw eventsError;
      const rows = (eventsData ?? []) as (EventRow & { location_name?: string | null })[];
      const out: InviteSheetEventRow[] = [];
      for (const e of rows) {
        if (!isEventVisible(e)) continue;
        const eventDate = new Date(e.event_date);
        const end = getEventEndTime(e.event_date, e.duration_minutes);
        if (now >= end) continue;
        out.push({
          id: e.id,
          title: e.title,
          cover_url: e.cover_image || undefined,
          start_time: e.event_date,
          city: e.location_name?.trim() || undefined,
        });
      }
      return out;
    },
  });
}

/** Matches web `EventRegistrationSnapshot`: lobby/deck require `isConfirmed` only. */
export type EventRegistrationSnapshot = {
  isConfirmed: boolean;
  isWaitlisted: boolean;
};

export function useIsRegisteredForEvent(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['event-registration-check', eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<EventRegistrationSnapshot> => {
      if (!eventId || !userId) return { isConfirmed: false, isWaitlisted: false };
      const { data, error } = await supabase
        .from('event_registrations')
        .select('admission_status')
        .eq('event_id', eventId)
        .eq('profile_id', userId)
        .maybeSingle();
      if (error) return { isConfirmed: false, isWaitlisted: false };
      const s = data?.admission_status;
      return {
        isConfirmed: s === 'confirmed',
        isWaitlisted: s === 'waitlisted',
      };
    },
  });
}

export type NextRegisteredEventResult = {
  event: EventListItem | null;
  /** Confirmed seat for `event` (lobby-eligible). */
  isRegistered: boolean;
  isWaitlisted: boolean;
  hasEventAdmission: boolean;
};

/** Next event for dashboard — web parity: user's next registered event (or first visible upcoming if none). */
export function useNextRegisteredEvent(userId: string | null | undefined, canCityBrowse: boolean) {
  return useQuery({
    queryKey: ['next-registered-event', userId, canCityBrowse],
    enabled: !!userId,
    queryFn: async (): Promise<NextRegisteredEventResult> => {
      if (!userId)
        return { event: null, isRegistered: false, isWaitlisted: false, hasEventAdmission: false };
      const now = new Date();

      const { data: regRows, error: regError } = await supabase
        .from('event_registrations')
        .select('event_id, admission_status')
        .eq('profile_id', userId);

      if (regError) throw regError;
      type RegR = { event_id: string | null; admission_status: string | null };
      const regs = (regRows ?? []) as RegR[];
      const eventIds = regs.map((r) => r.event_id).filter(Boolean) as string[];
      if (eventIds.length === 0) {
        const first = await fetchFirstUpcomingVisibleEvent(userId, canCityBrowse);
        return { event: first, isRegistered: false, isWaitlisted: false, hasEventAdmission: false };
      }

      const statusByEvent = new Map<string, string>();
      for (const r of regs) {
        if (r.event_id) statusByEvent.set(r.event_id, r.admission_status ?? '');
      }

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees, language')
        .in('id', eventIds)
        .order('event_date', { ascending: true });

      if (eventsError) throw eventsError;
      const rows = (eventsData ?? []) as EventRow[];
      const visible = rows.filter((e) =>
        isEventVisible({
          event_date: e.event_date,
          duration_minutes: e.duration_minutes,
          status: e.status,
        })
      );
      const notEnded = visible.filter((e) => {
        const eventDate = new Date(e.event_date);
        const durationMs = (e.duration_minutes ?? 60) * 60 * 1000;
        const eventEnd = new Date(eventDate.getTime() + durationMs);
        return now < eventEnd;
      });
      if (notEnded.length > 0) {
        notEnded.sort((a, b) => {
          const sa = statusByEvent.get(a.id);
          const sb = statusByEvent.get(b.id);
          const pa = sa === 'confirmed' ? 0 : sa === 'waitlisted' ? 1 : 2;
          const pb = sb === 'confirmed' ? 0 : sb === 'waitlisted' ? 1 : 2;
          if (pa !== pb) return pa - pb;
          return new Date(a.event_date).getTime() - new Date(b.event_date).getTime();
        });
        const e = notEnded[0];
        const eventDate = new Date(e.event_date);
        const durationMs = (e.duration_minutes ?? 60) * 60 * 1000;
        const end = new Date(eventDate.getTime() + durationMs);
        const isLive = now >= eventDate && now < end;
        const st = statusByEvent.get(e.id) ?? '';
        const isConfirmed = st === 'confirmed';
        const isWaitlisted = st === 'waitlisted';
        return {
          event: rowToEventListItem(e, eventDate, isLive),
          isRegistered: isConfirmed,
          isWaitlisted,
          hasEventAdmission: isConfirmed || isWaitlisted,
        };
      }
      const first = await fetchFirstUpcomingVisibleEvent(userId, canCityBrowse);
      return { event: first, isRegistered: false, isWaitlisted: false, hasEventAdmission: false };
    },
  });
}

function rowToEventListItem(
  e: EventRow,
  eventDate: Date,
  isLive: boolean
): EventListItem {
  const durationMs = (e.duration_minutes ?? 60) * 60 * 1000;
  const end = new Date(eventDate.getTime() + durationMs);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    image: e.cover_image,
    date: formatEventDate(eventDate),
    time: formatEventTime(eventDate),
    attendees: e.current_attendees ?? 0,
    tags: e.tags ?? [],
    status: isLive ? 'live' : (e.status || 'upcoming'),
    eventDate,
    duration_minutes: e.duration_minutes ?? 60,
  };
}

async function fetchFirstUpcomingVisibleEvent(userId: string, canCityBrowse: boolean): Promise<EventListItem | null> {
  const list = await fetchVisibleEventsList(userId, {
    locationMode: 'nearby',
    selectedCity: null,
    distanceKm: 50,
    deviceCoords: null,
    canCityBrowse,
  });
  const now = new Date();
  for (const item of list) {
    const end = new Date(item.eventDate.getTime() + item.duration_minutes * 60 * 1000);
    if (now < end) return item;
  }
  return null;
}

export function useRegisterForEvent() {
  const qc = useQueryClient();
  const register = useMutation({
    mutationFn: async (eventId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.rpc('register_for_event', {
        p_event_id: eventId,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? 'Registration failed');
      }
      const { data: reg } = await supabase
        .from('event_registrations')
        .select('admission_status')
        .eq('event_id', eventId)
        .eq('profile_id', user.id)
        .maybeSingle();
      trackEvent('event_registration_success', {
        event_id: eventId,
        admission_status: reg?.admission_status ?? null,
      });
    },
    onSuccess: (_, eventId) => {
      qc.invalidateQueries({ queryKey: ['event-registration-check'] });
      qc.invalidateQueries({ queryKey: ['events-discover'] });
      qc.invalidateQueries({ queryKey: ['next-registered-event'] });
      qc.invalidateQueries({ queryKey: ['user-registered-event-ids'] });
      qc.invalidateQueries({ queryKey: ['event-attendees', eventId] });
      qc.invalidateQueries({ queryKey: ['event-attendee-preview', eventId] });
    },
  });
  const unregister = useMutation({
    mutationFn: async (eventId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: reg } = await supabase
        .from('event_registrations')
        .select('admission_status')
        .eq('event_id', eventId)
        .eq('profile_id', user.id)
        .maybeSingle();
      const { data, error } = await supabase.rpc('cancel_event_registration', {
        p_event_id: eventId,
      });
      if (error) throw error;
      const result = data as { success?: boolean } | null;
      if (!result?.success) throw new Error('Cancellation failed');
      trackEvent('event_unregistered', {
        event_id: eventId,
        admission_status: reg?.admission_status ?? null,
      });
    },
    onSuccess: (_, eventId) => {
      qc.invalidateQueries({ queryKey: ['event-registration-check'] });
      qc.invalidateQueries({ queryKey: ['events-discover'] });
      qc.invalidateQueries({ queryKey: ['next-registered-event'] });
      qc.invalidateQueries({ queryKey: ['user-registered-event-ids'] });
      qc.invalidateQueries({ queryKey: ['event-attendees', eventId] });
      qc.invalidateQueries({ queryKey: ['event-attendee-preview', eventId] });
    },
  });
  return {
    registerForEvent: (eventId: string) => register.mutateAsync(eventId).then(() => true).catch(() => false),
    unregisterFromEvent: (eventId: string) => unregister.mutateAsync(eventId).then(() => true).catch(() => false),
    isRegistering: register.isPending,
    isUnregistering: unregister.isPending,
  };
}

export type { DeckProfile };

export function useEventDeck(eventId: string, viewerProfileId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['event-deck', eventId, viewerProfileId],
    queryFn: async (): Promise<DeckProfile[]> => {
      if (!viewerProfileId || !eventId) return [];
      const { data, error } = await supabase.rpc('get_event_deck', {
        p_event_id: eventId,
        p_user_id: viewerProfileId,
        p_limit: 50,
      });
      if (error) throw error;
      return parseEventDeckProfiles(data);
    },
    enabled: enabled && !!viewerProfileId && !!eventId,
    refetchInterval: 15000,
    staleTime: 10000,
  });
}

/** @alias SwipeSessionStageResult — `match` / `match_queued` ids are `video_sessions.id`, not `matches.id`. */
export type SwipeResult = SwipeSessionStageResult;

export type { DrainMatchQueueResult };

export async function swipe(eventId: string, targetId: string, swipeType: 'vibe' | 'pass' | 'super_vibe'): Promise<SwipeResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke('swipe-actions', {
    body: { event_id: eventId, target_id: targetId, swipe_type: swipeType },
  });
  if (error) return null;
  return data as SwipeResult;
}

const SUPER_VIBE_LIMIT_PER_EVENT = 3;

/** Drain match queue when user returns to browsing. Returns first ready match if any. */
export async function drainMatchQueue(
  eventId: string,
  userId: string,
): Promise<DrainMatchQueueResult | null> {
  const { data, error } = await supabase.rpc('drain_match_queue', {
    p_event_id: eventId,
  });
  if (error) return null;
  return data as DrainMatchQueueResult;
}

/** Count of queued matches (ready_gate_status = 'queued') for this user in this event. */
export async function getQueuedMatchCount(eventId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('video_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('ready_gate_status', 'queued')
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`);
  if (error) return 0;
  return count ?? 0;
}

/** Remaining Super Vibes for this event (max 3 per event). */
export async function getSuperVibeRemaining(eventId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('event_swipes')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('actor_id', userId)
    .eq('swipe_type', 'super_vibe');
  if (error) return SUPER_VIBE_LIMIT_PER_EVENT;
  const used = count ?? 0;
  return Math.max(0, SUPER_VIBE_LIMIT_PER_EVENT - used);
}

// ─── Event attendees (Who's Going) — server preview, top-2 + aggregates ───
export type EventAttendee = {
  id: string;
  name: string;
  age: number | null;
  avatar_url: string | null;
  photos: string[] | null;
};

export type { PreviewRevealedAttendee };

export type EventAttendeePreviewPayload =
  | {
      success: true;
      viewer_admission: 'confirmed' | 'waitlisted' | 'none';
      total_other_confirmed: number;
      visible_cohort_count: number;
      obscured_remaining: number;
      revealed: PreviewRevealedAttendee[];
    }
  | { success: false; error?: string; code?: string };

function parseAttendeePreview(data: unknown): EventAttendeePreviewPayload {
  const row = data as Record<string, unknown> | null;
  if (!row || row.success === false) {
    return {
      success: false,
      error: typeof row?.error === 'string' ? row.error : 'unknown',
      code: typeof row?.code === 'string' ? row.code : undefined,
    };
  }
  const revealed = parseEventAttendeePreviewRows(row.revealed);
  return {
    success: true,
    viewer_admission: row.viewer_admission as 'confirmed' | 'waitlisted' | 'none',
    total_other_confirmed: Number(row.total_other_confirmed ?? 0),
    visible_cohort_count: Number(row.visible_cohort_count ?? 0),
    obscured_remaining: Number(row.obscured_remaining ?? 0),
    revealed,
  };
}

export function useEventAttendeePreview(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-attendee-preview', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventAttendeePreviewPayload> => {
      if (!eventId) return { success: false, error: 'missing_event' };
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return { success: false, error: 'not_signed_in' };

      const { data, error } = await supabase.rpc('get_event_attendee_preview', {
        p_event_id: eventId,
        p_viewer_id: user.id,
      });
      if (error) {
        if (__DEV__) console.warn('[eventsApi] get_event_attendee_preview', error.message);
        return { success: false, error: error.message };
      }
      return parseAttendeePreview(data);
    },
  });
}

/** @deprecated Use `useEventAttendeePreview`; this maps `revealed` to legacy card rows (max 2). */
export function useEventAttendees(eventId: string | undefined) {
  const q = useEventAttendeePreview(eventId);
  const mapped: EventAttendee[] =
    q.data?.success === true
      ? q.data.revealed.map((r) => ({
          id: r.id,
          name: r.name,
          age: r.age,
          avatar_url: r.avatar_path,
          photos: r.avatar_path ? [r.avatar_path] : null,
        }))
      : [];
  return { ...q, data: mapped, preview: q.data };
}

// ─── Event vibes (pre-event interest) ───
export type EventVibeMutual = {
  id: string;
  name: string;
  avatar: string | null;
  age: number;
};

/** Sent vibe receiver IDs for this event and user. */
export function useEventVibesSent(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['event-vibes-sent', eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<string[]> => {
      if (!eventId || !userId) return [];
      const { data, error } = await supabase
        .from('event_vibes')
        .select('receiver_id')
        .eq('event_id', eventId)
        .eq('sender_id', userId);
      if (error) return [];
      return (data ?? []).map((r) => r.receiver_id);
    },
  });
}

export type EventVibeReceived = {
  sender_id: string;
  sender?: { id: string; name: string; avatar_url: string | null; age: number };
};

/** Received vibes with sender profile for this event and user. */
export function useEventVibesReceived(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['event-vibes-received', eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<EventVibeReceived[]> => {
      if (!eventId || !userId) return [];
      const { data, error } = await supabase
        .from('event_vibes')
        .select('sender_id')
        .eq('event_id', eventId)
        .eq('receiver_id', userId);
      if (error || !data?.length) return [];
      const senderIds = [...new Set(data.map((r) => r.sender_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, age')
        .in('id', senderIds);
      return data.map((r) => {
        const p = profiles?.find((x) => x.id === r.sender_id);
        return {
          sender_id: r.sender_id,
          sender: p ? { id: p.id, name: p.name ?? 'Unknown', avatar_url: p.avatar_url, age: p.age ?? 0 } : undefined,
        };
      });
    },
  });
}

/** Send a vibe to an attendee. */
export async function sendEventVibe(eventId: string, userId: string, receiverId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('event_vibes').insert({
    event_id: eventId,
    sender_id: userId,
    receiver_id: receiverId,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'You already sent a vibe to this person' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
