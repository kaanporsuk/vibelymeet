import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SelectedCity } from '@/components/events/EventFilterSheet';

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
  isPremium: boolean;
};

/**
 * Same RPC as web `useVisibleEvents` — premium browse + radius enforced server-side.
 */
export async function fetchVisibleEventsList(
  userId: string,
  _legacyIsPremium: boolean,
  discover?: DiscoverEventsParams,
): Promise<EventListItem[]> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('location_data')
    .eq('id', userId)
    .maybeSingle();
  if (profileError && __DEV__) {
    console.warn('[eventsApi] profile location fetch failed:', profileError.message);
  }
  const loc = profile?.location_data as { lat?: number; lng?: number } | null;

  const d = discover;
  const mode = !d?.isPremium ? 'nearby' : (d.locationMode ?? 'nearby');
  const deviceLat = d?.deviceCoords?.lat ?? null;
  const deviceLng = d?.deviceCoords?.lng ?? null;
  const p_user_lat = (deviceLat ?? loc?.lat) ?? undefined;
  const p_user_lng = (deviceLng ?? loc?.lng) ?? undefined;

  let p_browse_lat: number | null = null;
  let p_browse_lng: number | null = null;
  if (mode === 'city' && d?.isPremium && d.selectedCity) {
    p_browse_lat = d.selectedCity.lat;
    p_browse_lng = d.selectedCity.lng;
  }

  const hasRefPoint =
    (mode === 'city' && !!d?.selectedCity && !!d?.isPremium) ||
    (mode === 'nearby' && p_user_lat != null && p_user_lng != null);

  const filterKm = d?.distanceKm ?? 50;
  const p_filter_radius_km =
    hasRefPoint && filterKm > 0
      ? mode === 'city' && (!d?.selectedCity || !d?.isPremium)
        ? null
        : filterKm
      : null;

  const { data, error } = await supabase.rpc('get_visible_events', {
    p_user_id: userId,
    p_user_lat: p_user_lat ?? null,
    p_user_lng: p_user_lng ?? null,
    p_is_premium: false,
    p_browse_lat,
    p_browse_lng,
    p_filter_radius_km,
  });
  if (error) throw error;
  const rows = (data ?? []) as VisibleEventRpcRow[];
  return rows
    .map(visibleRpcRowToListItem)
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
}

/**
 * Discover events list — `get_visible_events` with location/radius (web parity).
 */
export function useDiscoverEvents(
  userId: string | null | undefined,
  params: DiscoverEventsParams,
) {
  return useQuery({
    queryKey: [
      'events-discover',
      userId,
      params.isPremium,
      params.locationMode,
      params.selectedCity?.lat,
      params.selectedCity?.lng,
      params.distanceKm,
      params.deviceCoords?.lat,
      params.deviceCoords?.lng,
    ],
    queryFn: () => fetchVisibleEventsList(userId!, false, params),
    enabled: !!userId,
  });
}

/** Dashboard / simple callers: nearby list via RPC (profile location + default radius). */
export function useEvents(userId: string | null | undefined, isPremium: boolean) {
  return useDiscoverEvents(userId, {
    locationMode: 'nearby',
    selectedCity: null,
    distanceKm: 50,
    deviceCoords: null,
    isPremium: !!isPremium,
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
      if (error) throw error;
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
      if (error) throw error;
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

export function useIsRegisteredForEvent(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['event-registration-check', eventId, userId],
    enabled: !!eventId && !!userId,
    queryFn: async (): Promise<boolean> => {
      if (!eventId || !userId) return false;
      const { data, error } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', eventId)
        .eq('profile_id', userId)
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });
}

export type NextRegisteredEventResult = {
  event: EventListItem | null;
  isRegistered: boolean;
};

/** Next event for dashboard — web parity: user's next registered event (or first visible upcoming if none). */
export function useNextRegisteredEvent(userId: string | null | undefined, isPremium: boolean) {
  return useQuery({
    queryKey: ['next-registered-event', userId, isPremium],
    enabled: !!userId,
    queryFn: async (): Promise<NextRegisteredEventResult> => {
      if (!userId) return { event: null, isRegistered: false };
      const now = new Date();

      const { data: regRows, error: regError } = await supabase
        .from('event_registrations')
        .select('event_id')
        .eq('profile_id', userId);

      if (regError) throw regError;
      const eventIds = (regRows ?? []).map((r) => r.event_id).filter(Boolean);
      if (eventIds.length === 0) {
        const first = await fetchFirstUpcomingVisibleEvent(userId, isPremium);
        return { event: first, isRegistered: false };
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
        const e = notEnded[0];
        const eventDate = new Date(e.event_date);
        const durationMs = (e.duration_minutes ?? 60) * 60 * 1000;
        const end = new Date(eventDate.getTime() + durationMs);
        const isLive = now >= eventDate && now < end;
        return {
          event: rowToEventListItem(e, eventDate, isLive),
          isRegistered: true,
        };
      }
      const first = await fetchFirstUpcomingVisibleEvent(userId, isPremium);
      return { event: first, isRegistered: false };
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

async function fetchFirstUpcomingVisibleEvent(userId: string, isPremium: boolean): Promise<EventListItem | null> {
  const list = await fetchVisibleEventsList(userId, isPremium);
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
      const { error } = await supabase
        .from('event_registrations')
        .insert({ event_id: eventId, profile_id: user.id });
      if (error) throw error;
    },
    onSuccess: (_, eventId) => {
      qc.invalidateQueries({ queryKey: ['event-registration-check'] });
      qc.invalidateQueries({ queryKey: ['events-discover'] });
      qc.invalidateQueries({ queryKey: ['next-registered-event'] });
      qc.invalidateQueries({ queryKey: ['user-registered-event-ids'] });
      qc.invalidateQueries({ queryKey: ['event-attendees', eventId] });
    },
  });
  const unregister = useMutation({
    mutationFn: async (eventId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('event_registrations')
        .delete()
        .eq('event_id', eventId)
        .eq('profile_id', user.id);
      if (error) throw error;
    },
    onSuccess: (_, eventId) => {
      qc.invalidateQueries({ queryKey: ['event-registration-check'] });
      qc.invalidateQueries({ queryKey: ['events-discover'] });
      qc.invalidateQueries({ queryKey: ['next-registered-event'] });
      qc.invalidateQueries({ queryKey: ['user-registered-event-ids'] });
      qc.invalidateQueries({ queryKey: ['event-attendees', eventId] });
    },
  });
  return {
    registerForEvent: (eventId: string) => register.mutateAsync(eventId).then(() => true).catch(() => false),
    unregisterFromEvent: (eventId: string) => unregister.mutateAsync(eventId).then(() => true).catch(() => false),
    isRegistering: register.isPending,
    isUnregistering: unregister.isPending,
  };
}

export type DeckProfile = {
  profile_id: string;
  name: string;
  age: number;
  gender: string;
  avatar_url: string | null;
  photos: string[] | null;
  about_me: string | null;
  job: string | null;
  location: string | null;
  tagline: string | null;
  looking_for: string | null;
  queue_status: string | null;
  has_met_before: boolean;
  is_already_connected: boolean;
  has_super_vibed: boolean;
  shared_vibe_count: number;
};

export function useEventDeck(eventId: string, userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['event-deck', eventId, userId],
    queryFn: async (): Promise<DeckProfile[]> => {
      if (!userId || !eventId) return [];
      const { data, error } = await supabase.rpc('get_event_deck', {
        p_event_id: eventId,
        p_user_id: userId,
        p_limit: 50,
      });
      if (error) throw error;
      return (data as DeckProfile[]) ?? [];
    },
    enabled: enabled && !!userId && !!eventId,
    refetchInterval: 15000,
    staleTime: 10000,
  });
}

export type SwipeResult = { result: string; match_id?: string; immediate?: boolean };

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
export async function drainMatchQueue(eventId: string, userId: string): Promise<{ found: boolean; match_id?: string; partner_id?: string } | null> {
  const { data, error } = await supabase.rpc('drain_match_queue', {
    p_event_id: eventId,
    p_user_id: userId,
  });
  if (error) return null;
  return data as { found: boolean; match_id?: string; partner_id?: string };
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

// ─── Event attendees (Who's Going) ───
export type EventAttendee = {
  id: string;
  name: string;
  age: number | null;
  avatar_url: string | null;
  photos: string[] | null;
};

/** Fetch attendees for an event (event_registrations + profiles). */
export function useEventAttendees(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-attendees', eventId],
    enabled: !!eventId,
    queryFn: async (): Promise<EventAttendee[]> => {
      if (!eventId) return [];
      const { data: regs, error: regError } = await supabase
        .from('event_registrations')
        .select('profile_id')
        .eq('event_id', eventId);
      if (regError || !regs?.length) return [];
      const profileIds = [...new Set(regs.map((r) => r.profile_id).filter(Boolean))];
      const { data: profiles, error: profError } = await supabase
        .from('profiles')
        .select('id, name, age, avatar_url, photos')
        .in('id', profileIds);
      if (profError || !profiles?.length) return [];
      return profiles.map((p) => ({
        id: p.id,
        name: p.name ?? 'Guest',
        age: p.age ?? null,
        avatar_url: p.avatar_url,
        photos: (p.photos as string[] | null) ?? null,
      }));
    },
  });
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
