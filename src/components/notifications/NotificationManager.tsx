import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEventReminders } from '@/hooks/useEventReminders';
import { usePushNotifications } from '@/hooks/usePushNotifications';

/**
 * Background notification manager that handles:
 * - Event reminders (30 min before registered events)
 * - Date reminders
 * 
 * Daily Drop notifications are now handled server-side via generate-daily-drops.
 */
export function NotificationManager() {
  const { user } = useAuth();
  const { permission, isGranted } = usePushNotifications();
  const { registeredEvents, scheduledCount } = useEventReminders();

  useEffect(() => {
    if (!user || !isGranted) return;
    
    console.log('[NotificationManager] Active event reminders:', scheduledCount);
    console.log('[NotificationManager] Registered upcoming events:', registeredEvents.length);
  }, [user, isGranted, scheduledCount, registeredEvents.length]);

  return null;
}
