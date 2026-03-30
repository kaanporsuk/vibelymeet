import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/AuthContext';

export interface EventAttendee {
  id: string;
  name: string;
  avatar_url: string | null;
  photos: string[] | null;
}

export function useEventAttendees(eventId: string, limit: number = 5) {
  const { user } = useUserProfile();

  return useQuery({
    queryKey: ['event-attendees', eventId, user?.id, limit],
    enabled: !!eventId && !!user?.id,
    staleTime: 30000, // Cache for 30 seconds
    queryFn: async (): Promise<EventAttendee[]> => {
      if (!eventId || !user?.id) return [];

      const { data: visibleIds, error: visibleError } = await supabase.rpc(
        'get_event_visible_attendees',
        {
          p_event_id: eventId,
          p_viewer_id: user.id,
        }
      );
      if (visibleError) {
        console.error('Error fetching visible attendees:', visibleError);
        return [];
      }
      const visibleOrdered = ((visibleIds ?? []).filter(Boolean) as string[]).slice(0, Math.max(limit, 0));
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
