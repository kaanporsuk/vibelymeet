import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
        .limit(limit);

      if (regError) {
        console.error('Error fetching registrations:', regError);
        return [];
      }

      if (!registrations?.length) return [];

      const profileIds = registrations.map(r => r.profile_id);

      // Fetch profile details for attendees
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, photos')
        .in('id', profileIds);

      if (profilesError) {
        console.error('Error fetching attendee profiles:', profilesError);
        return [];
      }

      return (profiles || []).map(profile => ({
        id: profile.id,
        name: profile.name,
        avatar_url: profile.avatar_url,
        photos: profile.photos,
      }));
    },
  });
}
