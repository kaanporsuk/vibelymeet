import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserProfile } from '@/contexts/AuthContext';

interface RegisteredEvent {
  id: string;
  title: string;
  event_date: string;
  cover_image: string;
}

/**
 * Upcoming events the user is registered for (read-only list).
 *
 * 30-minute (and 5-minute) reminder *delivery* is canonical on the server:
 * `event-reminders` → `event_reminder_queue` → `send-notification` → OneSignal,
 * which enforces notification_preferences (master toggle, category, pause, quiet hours, etc.).
 *
 * Previous local `window.Notification` / legacy SW scheduling duplicated those reminders and could
 * bypass prefs — removed in favor of the single server-gated path.
 */
export function useEventReminders() {
  const { user } = useUserProfile();

  const { data: registeredEvents = [] } = useQuery({
    queryKey: ['registered-events-for-reminders', user?.id],
    enabled: !!user?.id,
    refetchInterval: 60000,
    queryFn: async (): Promise<RegisteredEvent[]> => {
      if (!user?.id) return [];

      const { data: registrations, error: regError } = await supabase
        .from('event_registrations')
        .select('event_id')
        .eq('profile_id', user.id);

      if (regError || !registrations?.length) return [];

      const eventIds = registrations.map((r) => r.event_id);

      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('id, title, event_date, cover_image')
        .in('id', eventIds)
        .gte('event_date', new Date().toISOString())
        .order('event_date', { ascending: true });

      if (eventsError) {
        console.error('Error fetching registered events:', eventsError);
        return [];
      }

      return events || [];
    },
  });

  return {
    registeredEvents,
    /** Always 0 — local scheduling removed; kept for callers that destructure the field. */
    scheduledCount: 0,
  };
}
