/**
 * Native parity with web `useRealtimeEvents` in `src/hooks/useEvents.ts`:
 * subscribe to `public.events` and `public.event_registrations` and invalidate
 * the mobile Events-related TanStack query keys so lists, detail, registration,
 * lobby deck, and home “next event” stay fresh without polling.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

function invalidateAfterEventsTableChange(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['events-discover'] });
  qc.invalidateQueries({ queryKey: ['event-details'] });
  qc.invalidateQueries({ queryKey: ['next-registered-event'] });
  qc.invalidateQueries({ queryKey: ['other-city-events'] });
  qc.invalidateQueries({ queryKey: ['registered-upcoming-events-invite'] });
  qc.invalidateQueries({ queryKey: ['event-deck'] });
}

function invalidateAfterRegistrationsTableChange(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['events-discover'] });
  qc.invalidateQueries({ queryKey: ['event-details'] });
  qc.invalidateQueries({ queryKey: ['next-registered-event'] });
  qc.invalidateQueries({ queryKey: ['user-registered-event-ids'] });
  qc.invalidateQueries({ queryKey: ['event-registration-check'] });
  qc.invalidateQueries({ queryKey: ['event-attendees'] });
  qc.invalidateQueries({ queryKey: ['event-attendee-preview'] });
  qc.invalidateQueries({ queryKey: ['registered-upcoming-events-invite'] });
  qc.invalidateQueries({ queryKey: ['event-deck'] });
}

/** Subscribes while `userId` is set (signed-in). Tears down on sign-out. */
export function useRealtimeEvents(userId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('events-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        () => invalidateAfterEventsTableChange(queryClient)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_registrations' },
        () => invalidateAfterRegistrationsTableChange(queryClient)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);
}
