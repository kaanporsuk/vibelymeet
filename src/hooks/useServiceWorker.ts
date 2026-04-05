import { useState, useEffect, useCallback } from "react";

/**
 * Legacy helpers for scheduling/showing notifications via a custom service worker.
 * We no longer register public/sw.js — OneSignal owns the root-scoped worker (OneSignalSDK.sw.js)
 * for web push. These APIs remain as no-ops when there is no custom registration; callers
 * (usePushNotifications, useEventReminders) fall back to localStorage + window.Notification.
 */
export function useServiceWorker() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const supported = "serviceWorker" in navigator;
    setIsSupported(supported);
    setRegistration(null);
    setIsReady(false);
  }, []);

  const sendMessage = useCallback((message: unknown) => {
    if (registration?.active) {
      registration.active.postMessage(message);
    }
  }, [registration]);

  const scheduleNotification = useCallback(
    (
      id: string,
      title: string,
      body: string,
      scheduledAt: Date,
      url?: string
    ) => {
      sendMessage({
        type: "SCHEDULE_NOTIFICATION",
        payload: { id, title, body, scheduledAt: scheduledAt.toISOString(), url },
      });
    },
    [sendMessage]
  );

  const showNotification = useCallback(
    (title: string, body: string, tag?: string, url?: string) => {
      sendMessage({
        type: "SHOW_NOTIFICATION",
        payload: { title, body, tag, url },
      });
    },
    [sendMessage]
  );

  const scheduleDateReminder = useCallback(
    (matchName: string, dateTime: Date, minutesBefore: number = 15) => {
      const reminderTime = new Date(dateTime.getTime() - minutesBefore * 60 * 1000);
      if (reminderTime <= new Date()) return;
      scheduleNotification(
        "date-reminder-" + dateTime.toISOString(),
        `📅 Date with ${matchName} starting soon!`,
        `Your video date starts in ${minutesBefore} minutes. Get ready!`,
        reminderTime,
        "/schedule"
      );
    },
    [scheduleNotification]
  );

  return {
    isSupported,
    isReady,
    registration,
    sendMessage,
    scheduleNotification,
    showNotification,
    scheduleDateReminder,
  };
}
