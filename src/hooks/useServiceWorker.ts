import { useState, useEffect, useCallback } from 'react';

export function useServiceWorker() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator;
    setIsSupported(supported);

    if (!supported) {
      console.log('[useServiceWorker] Service workers not supported');
      return;
    }

    // Register the service worker
    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        
        console.log('[useServiceWorker] Service worker registered:', reg.scope);
        setRegistration(reg);

        // Wait for the service worker to be ready
        const readyReg = await navigator.serviceWorker.ready;
        setRegistration(readyReg);
        setIsReady(true);
        console.log('[useServiceWorker] Service worker ready');

        // Try to register periodic sync for daily drops
        if ('periodicSync' in readyReg) {
          try {
            await (readyReg as any).periodicSync.register('daily-drop-check', {
              minInterval: 60 * 60 * 1000, // 1 hour minimum
            });
            console.log('[useServiceWorker] Periodic sync registered');
          } catch (e) {
            console.log('[useServiceWorker] Periodic sync not available:', e);
          }
        }
      } catch (error) {
        console.error('[useServiceWorker] Registration failed:', error);
      }
    };

    registerSW();
  }, []);

  // Send a message to the service worker
  const sendMessage = useCallback((message: any) => {
    if (registration?.active) {
      registration.active.postMessage(message);
    }
  }, [registration]);

  // Schedule a notification via service worker
  const scheduleNotification = useCallback((
    id: string,
    title: string,
    body: string,
    scheduledAt: Date,
    url?: string
  ) => {
    sendMessage({
      type: 'SCHEDULE_NOTIFICATION',
      payload: { id, title, body, scheduledAt: scheduledAt.toISOString(), url },
    });
  }, [sendMessage]);

  // Show an immediate notification via service worker
  const showNotification = useCallback((
    title: string,
    body: string,
    tag?: string,
    url?: string
  ) => {
    sendMessage({
      type: 'SHOW_NOTIFICATION',
      payload: { title, body, tag, url },
    });
  }, [sendMessage]);


  // Schedule date reminder notification
  const scheduleDateReminder = useCallback((
    matchName: string,
    dateTime: Date,
    minutesBefore: number = 15
  ) => {
    const reminderTime = new Date(dateTime.getTime() - minutesBefore * 60 * 1000);

    if (reminderTime <= new Date()) return;

    scheduleNotification(
      'date-reminder-' + dateTime.toISOString(),
      `📅 Date with ${matchName} starting soon!`,
      `Your video date starts in ${minutesBefore} minutes. Get ready!`,
      reminderTime,
      '/video-date'
    );

    console.log('[useServiceWorker] Date reminder scheduled for:', reminderTime);
  }, [scheduleNotification]);

  return {
    isSupported,
    isReady,
    registration,
    sendMessage,
    scheduleNotification,
    showNotification,
    scheduleDailyDropNotification,
    scheduleDateReminder,
  };
}
