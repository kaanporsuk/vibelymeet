import { useEffect, useCallback } from 'react';
import { usePushNotifications } from './usePushNotifications';
import { useAuth } from '@/contexts/AuthContext';

const DAILY_DROP_SCHEDULED_KEY = 'vibely_daily_drop_scheduled';
const DROP_HOUR = 18; // 6 PM

export function useDailyDropNotifications() {
  const { user } = useAuth();
  const {
    isSupported,
    isGranted,
    requestPermission,
    sendNotification,
    scheduleNotification,
    cancelScheduledNotification,
  } = usePushNotifications();

  // Check if we should schedule today's notification
  const scheduleNextDropNotification = useCallback(() => {
    if (!isGranted || !user) return null;

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Check if we already scheduled for today
    const scheduledData = localStorage.getItem(DAILY_DROP_SCHEDULED_KEY);
    if (scheduledData) {
      try {
        const parsed = JSON.parse(scheduledData);
        if (parsed.date === today && parsed.userId === user.id) {
          // Already scheduled for today
          return parsed.notificationId;
        }
      } catch (e) {
        // Invalid data, proceed to schedule
      }
    }

    // Calculate next drop time
    const dropTime = new Date(now);
    dropTime.setHours(DROP_HOUR, 0, 0, 0);

    // If it's past 6 PM, schedule for tomorrow
    if (now >= dropTime) {
      dropTime.setDate(dropTime.getDate() + 1);
    }

    // Schedule the notification
    const notificationId = scheduleNotification({
      title: '💧 Your Daily Drop is Ready!',
      body: 'A new curated match is waiting for you. Open Vibely to discover who it is!',
      scheduledAt: dropTime.toISOString(),
      type: 'daily_drop',
    });

    // Save scheduled info
    localStorage.setItem(DAILY_DROP_SCHEDULED_KEY, JSON.stringify({
      date: dropTime.toISOString().split('T')[0],
      userId: user.id,
      notificationId,
    }));

    console.log('Scheduled daily drop notification for:', dropTime.toISOString());
    return notificationId;
  }, [isGranted, user, scheduleNotification]);

  // Send immediate notification when drop is ready
  const sendDropReadyNotification = useCallback(() => {
    if (!isGranted) return null;

    return sendNotification('💧 Your Daily Drop is Here!', {
      body: 'A new curated match is waiting for you. Tap to see who it is!',
      tag: 'daily-drop-ready',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      requireInteraction: true,
    });
  }, [isGranted, sendNotification]);

  // Request permission and schedule on mount
  useEffect(() => {
    if (!isSupported || !user) return;

    // If permission is granted, schedule notification
    if (isGranted) {
      scheduleNextDropNotification();
    }
  }, [isSupported, isGranted, user, scheduleNextDropNotification]);

  // Re-schedule at midnight for the next day
  useEffect(() => {
    if (!isGranted || !user) return;

    const checkAndReschedule = () => {
      const now = new Date();
      // If it's a new day, reschedule
      scheduleNextDropNotification();
    };

    // Check every hour
    const interval = setInterval(checkAndReschedule, 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isGranted, user, scheduleNextDropNotification]);

  return {
    isSupported,
    isEnabled: isGranted,
    requestPermission,
    sendDropReadyNotification,
    scheduleNextDropNotification,
  };
}
