import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { filterVisibleProfileIds } from '@/lib/profileVisibility';

export interface EventAttendee {
  id: string;
  name: string;
  avatar_url: string | null;
  photos: string[] | null;
}

export function useEventAttendees(eventId: string, limit: number = 5) {
  return useQuery({
    queryKey: ['event-attendees', eventId, limit],
    enabled: !!eventId,
    staleTime: 30000, // Cache for 30 seconds
    queryFn: async (): Promise<EventAttendee[]> => {
      // First get registrations for this event
      const { data: registrations, error: regError } = await supabase
        .from('event_registrations')
        .select('profile_id')
        .eq('event_id', eventId)
        .limit(Math.max(limit * 5, 25));

      if (regError) {
        console.error('Error fetching registrations:', regError);
        return [];
      }

      if (!registrations?.length) return [];

      const orderedIds = registrations.map((r) => r.profile_id);
      const visibleSet = await filterVisibleProfileIds(orderedIds);
      const visibleOrdered = orderedIds.filter((id) => visibleSet.has(id)).slice(0, limit);
      if (visibleOrdered.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, photos')
        .in('id', visibleOrdered);

      if (profilesError) {
        console.error('Error fetching attendee profiles:', profilesError);
        return [];
      }

      const byId = new Map((profiles || []).map((p) => [p.id, p]));
      return visibleOrdered
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((profile) => ({
          id: profile!.id,
          name: profile!.name,
          avatar_url: profile!.avatar_url,
          photos: profile!.photos,
        }));
    },
  });
}
