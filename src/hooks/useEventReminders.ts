import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { useServiceWorker } from './useServiceWorker';

const REMINDER_STORAGE_KEY = 'vibely_event_reminders_sent';
const REMINDER_MINUTES_BEFORE = 30;

interface RegisteredEvent {
  id: string;
  title: string;
  event_date: string;
  cover_image: string;
}

// Track which event reminders have been sent
function getSentReminders(): Set<string> {
  try {
    const stored = localStorage.getItem(REMINDER_STORAGE_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function markReminderSent(eventId: string): void {
  const sent = getSentReminders();
  sent.add(eventId);
  localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify([...sent]));
}

export function useEventReminders() {
  const { user } = useUserProfile();
  const queryClient = useQueryClient();
  const { isReady: swReady, scheduleNotification, showNotification } = useServiceWorker();
  const scheduledRef = useRef<Set<string>>(new Set());

  // Fetch user's registered upcoming events
  const { data: registeredEvents = [] } = useQuery({
    queryKey: ['registered-events-for-reminders', user?.id],
    enabled: !!user?.id,
    refetchInterval: 60000, // Refetch every minute to catch new registrations
    queryFn: async (): Promise<RegisteredEvent[]> => {
      if (!user?.id) return [];

      // Get user's event registrations
      const { data: registrations, error: regError } = await supabase
        .from('event_registrations')
        .select('event_id')
        .eq('profile_id', user.id);

      if (regError || !registrations?.length) return [];

      const eventIds = registrations.map(r => r.event_id);

      // Fetch event details for registered events that are upcoming
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

  // Schedule notification for an event
  const scheduleEventReminder = useCallback((event: RegisteredEvent) => {
    const eventDate = new Date(event.event_date);
    const reminderTime = new Date(eventDate.getTime() - REMINDER_MINUTES_BEFORE * 60 * 1000);
    const now = new Date();

    // Skip if reminder time already passed
    if (reminderTime <= now) return;

    // Skip if already scheduled in this session
    if (scheduledRef.current.has(event.id)) return;

    // Skip if already sent
    const sentReminders = getSentReminders();
    if (sentReminders.has(event.id)) return;

    const title = `🎉 Event starts in 30 minutes!`;
    const body = `"${event.title}" is about to begin. Get ready to meet amazing people!`;
    const url = `/events/${event.id}`;

    // Use service worker for reliable background delivery
    if (swReady) {
      scheduleNotification(
        `event-reminder-${event.id}`,
        title,
        body,
        reminderTime,
        url
      );
      console.log(`[EventReminders] Scheduled SW notification for ${event.title} at ${reminderTime}`);
    } else {
      // Fallback: Use setTimeout for in-app scheduling
      const delay = reminderTime.getTime() - now.getTime();
      setTimeout(() => {
        const sent = getSentReminders();
        if (sent.has(event.id)) return;
        
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: event.cover_image || '/favicon.ico',
            tag: `event-reminder-${event.id}`,
            requireInteraction: true,
          });
          markReminderSent(event.id);
        }
      }, delay);
      console.log(`[EventReminders] Scheduled fallback notification for ${event.title} in ${delay}ms`);
    }

    scheduledRef.current.add(event.id);
  }, [swReady, scheduleNotification]);

  // Check for imminent events and show immediate notification
  const checkImminentEvents = useCallback(() => {
    const now = new Date();
    const sentReminders = getSentReminders();

    registeredEvents.forEach(event => {
      const eventDate = new Date(event.event_date);
      const reminderTime = new Date(eventDate.getTime() - REMINDER_MINUTES_BEFORE * 60 * 1000);
      const minutesUntilReminder = (reminderTime.getTime() - now.getTime()) / (60 * 1000);

      // If reminder should have fired within the last 5 minutes and wasn't sent
      if (minutesUntilReminder >= -5 && minutesUntilReminder <= 0 && !sentReminders.has(event.id)) {
        const title = `🎉 Event starts in 30 minutes!`;
        const body = `"${event.title}" is about to begin. Get ready to meet amazing people!`;

        if (swReady) {
          showNotification(title, body, `event-reminder-${event.id}`, `/events/${event.id}`);
        } else if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: event.cover_image || '/favicon.ico',
            tag: `event-reminder-${event.id}`,
            requireInteraction: true,
          });
        }
        markReminderSent(event.id);
      }
    });
  }, [registeredEvents, swReady, showNotification]);

  // Schedule reminders for all registered events
  useEffect(() => {
    if (!registeredEvents.length) return;

    registeredEvents.forEach(event => {
      scheduleEventReminder(event);
    });

    // Also check for imminent events that need immediate notification
    checkImminentEvents();
  }, [registeredEvents, scheduleEventReminder, checkImminentEvents]);

  // Periodic check for imminent events (every minute)
  useEffect(() => {
    const interval = setInterval(checkImminentEvents, 60000);
    return () => clearInterval(interval);
  }, [checkImminentEvents]);

  // Clean up old sent reminders (older than 24 hours)
  useEffect(() => {
    const cleanup = () => {
      const sentReminders = getSentReminders();
      const now = new Date();
      
      // Keep only reminders for upcoming events
      const validReminders = [...sentReminders].filter(eventId => {
        const event = registeredEvents.find(e => e.id === eventId);
        if (!event) return false;
        const eventDate = new Date(event.event_date);
        return eventDate > now;
      });
      
      localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(validReminders));
    };

    cleanup();
  }, [registeredEvents]);

  return {
    registeredEvents,
    scheduledCount: scheduledRef.current.size,
  };
}
