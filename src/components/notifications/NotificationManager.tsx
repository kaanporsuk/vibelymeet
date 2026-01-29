import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useEventReminders } from '@/hooks/useEventReminders';
import { usePushNotifications } from '@/hooks/usePushNotifications';

/**
 * Background notification manager that handles:
 * - Event reminders (30 min before registered events)
 * - Daily drop notifications
 * - Date reminders
 * 
 * This component should be mounted once for authenticated users.
 */
export function NotificationManager() {
  const { user } = useAuth();
  const { permission, isGranted, scheduleDailyDropNotification } = usePushNotifications();
  const { registeredEvents, scheduledCount } = useEventReminders();

  // Schedule daily drop notifications when permission is granted
  useEffect(() => {
    if (!user || !isGranted) return;
    
    // Schedule the daily drop notification
    scheduleDailyDropNotification();
    
    console.log('[NotificationManager] Active event reminders:', scheduledCount);
    console.log('[NotificationManager] Registered upcoming events:', registeredEvents.length);
  }, [user, isGranted, scheduleDailyDropNotification, scheduledCount, registeredEvents.length]);

  // This component doesn't render anything
  return null;
}
