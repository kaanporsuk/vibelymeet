import { useState, useEffect, useCallback } from 'react';
import { useServiceWorker } from './useServiceWorker';

const NOTIFICATION_PERMISSION_KEY = 'vibely_notification_permission';
const SCHEDULED_NOTIFICATIONS_KEY = 'vibely_scheduled_notifications';

interface ScheduledNotification {
  id: string;
  title: string;
  body: string;
  scheduledAt: string; // ISO date
  type: 'daily_drop' | 'date_reminder';
  data?: Record<string, unknown>;
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(false);
  const { 
    isReady: swReady, 
    scheduleDateReminder: swScheduleDateReminder,
    showNotification: swShowNotification,
  } = useServiceWorker();

  // Check support and permission on mount
  useEffect(() => {
    const supported = 'Notification' in window;
    setIsSupported(supported);
    
    if (supported) {
      setPermission(Notification.permission);
    }
  }, []);

  // Request permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn('Push notifications not supported on this platform');
      return false;
    }
    
    try {
      // This triggers the browser's native permission dialog
      const result = await Notification.requestPermission();
      console.log('Notification permission result:', result);
      setPermission(result);
      localStorage.setItem(NOTIFICATION_PERMISSION_KEY, result);
      return result === 'granted';
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }, [isSupported]);

  // Send immediate notification (uses service worker if available)
  const sendNotification = useCallback((title: string, options?: NotificationOptions): Notification | null => {
    if (!isSupported || permission !== 'granted') return null;

    // Use service worker for background support
    if (swReady) {
      swShowNotification(title, options?.body || '', options?.tag, '/');
      return null;
    }

    // Fallback to direct notification
    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options,
      });

      return notification;
    } catch (error) {
      console.error('Failed to send notification:', error);
      return null;
    }
  }, [isSupported, permission, swReady, swShowNotification]);

  // Schedule a notification (uses service worker or localStorage fallback)
  const scheduleNotification = useCallback((notification: Omit<ScheduledNotification, 'id'>): string => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const stored = localStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      const notifications: ScheduledNotification[] = stored ? JSON.parse(stored) : [];
      
      notifications.push({ ...notification, id });
      localStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(notifications));
      
      return id;
    } catch (error) {
      console.error('Failed to schedule notification:', error);
      return id;
    }
  }, []);

  // Cancel scheduled notification
  const cancelScheduledNotification = useCallback((id: string): void => {
    try {
      const stored = localStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      if (!stored) return;
      
      const notifications: ScheduledNotification[] = JSON.parse(stored);
      const filtered = notifications.filter(n => n.id !== id);
      localStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to cancel notification:', error);
    }
  }, []);

  // Check and fire due notifications
  const checkScheduledNotifications = useCallback(() => {
    if (permission !== 'granted') return;

    try {
      const stored = localStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
      if (!stored) return;

      const notifications: ScheduledNotification[] = JSON.parse(stored);
      const now = new Date();
      const remaining: ScheduledNotification[] = [];

      notifications.forEach(notif => {
        const scheduledTime = new Date(notif.scheduledAt);
        if (scheduledTime <= now) {
          sendNotification(notif.title, { body: notif.body, tag: notif.id });
        } else {
          remaining.push(notif);
        }
      });

      localStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(remaining));
    } catch (error) {
      console.error('Failed to check scheduled notifications:', error);
    }
  }, [permission, sendNotification]);

  // Schedule date reminder notification (uses service worker if ready)
  const scheduleDateReminder = useCallback((
    matchName: string,
    dateTime: Date,
    minutesBefore: number = 15
  ) => {
    const reminderTime = new Date(dateTime.getTime() - minutesBefore * 60 * 1000);

    // Don't schedule if the reminder time has already passed
    if (reminderTime <= new Date()) return null;

    // Prefer service worker for background support
    if (swReady) {
      swScheduleDateReminder(matchName, dateTime, minutesBefore);
      return 'sw-date-reminder';
    }

    return scheduleNotification({
      title: `📅 Date with ${matchName} starting soon!`,
      body: `Your video date starts in ${minutesBefore} minutes. Get ready!`,
      scheduledAt: reminderTime.toISOString(),
      type: 'date_reminder',
      data: { matchName, dateTime: dateTime.toISOString() },
    });
  }, [scheduleNotification, swReady, swScheduleDateReminder]);

  // Check scheduled notifications periodically
  useEffect(() => {
    if (!isSupported || permission !== 'granted') return;

    checkScheduledNotifications();
    const interval = setInterval(checkScheduledNotifications, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [isSupported, permission, checkScheduledNotifications]);

  return {
    isSupported,
    permission,
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    hasServiceWorker: swReady,
    requestPermission,
    sendNotification,
    scheduleNotification,
    cancelScheduledNotification,
    scheduleDailyDropNotification,
    scheduleDateReminder,
  };
}
