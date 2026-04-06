import { useEffect } from 'react';
import { useUserProfile } from '@/contexts/AuthContext';
import { useEventReminders } from '@/hooks/useEventReminders';

/**
 * Lightweight hook host for upcoming registered events (debug / future UI).
 * Event push reminders are server-driven (`event-reminders` → `send-notification`).
 */
export function NotificationManager() {
  const { user } = useUserProfile();
  const { registeredEvents } = useEventReminders();

  useEffect(() => {
    if (!user) return;
    if (import.meta.env.DEV) {
      console.log(
        '[NotificationManager] Upcoming registered events (server handles reminders):',
        registeredEvents.length,
      );
    }
  }, [user, registeredEvents.length]);

  return null;
}
