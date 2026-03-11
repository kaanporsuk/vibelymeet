import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
};

export function useEvents(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['events'],
    queryFn: async (): Promise<EventListItem[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, description, cover_image, event_date, current_attendees, tags, status, duration_minutes, max_attendees')
        .order('event_date', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as EventRow[];
      return rows
        .filter((e) =>
          isEventVisible({
            event_date: e.event_date,
            duration_minutes: e.duration_minutes,
            status: e.status,
          })
        )
        .map((e) => {
          const eventDate = new Date(e.event_date);
          const durationMs = (e.duration_minutes || 60) * 60 * 1000;
          const end = new Date(eventDate.getTime() + durationMs);
          const now = new Date();
          const isLive = now >= eventDate && now < end;
          return {
            id: e.id,
            title: e.title,
            description: e.description,
            image: e.cover_image,
            date: eventDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            time: eventDate.toLocaleTimeString(undefined, { hour: 'numeric' }),
            attendees: e.current_attendees ?? 0,
            tags: e.tags ?? [],
            status: isLive ? 'live' : (e.status || 'upcoming'),
            eventDate,
            duration_minutes: e.duration_minutes ?? 60,
          };
        });
    },
    enabled: true,
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
      qc.invalidateQueries({ queryKey: ['events'] });
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
      qc.invalidateQueries({ queryKey: ['events'] });
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
  bio: string | null;
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
