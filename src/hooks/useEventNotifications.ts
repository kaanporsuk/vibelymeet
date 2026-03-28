import { useCallback, useRef, useEffect, useState } from 'react';

const THROTTLE_MS = 30_000; // 30 seconds between notifications
const AUTO_CLOSE_MS = 10_000; // Auto-close after 10 seconds

export function useEventNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const lastNotifAt = useRef(0);
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission);
    }
  }, [isSupported]);

  const isTabHidden = useCallback(() => {
    return typeof document !== 'undefined' && document.hidden;
  }, []);

  const sendNotification = useCallback(
    (title: string, body: string, onClick?: () => void) => {
      if (!isSupported || permission !== 'granted') return;
      if (!isTabHidden()) return; // Only when tab is not focused

      const now = Date.now();
      if (now - lastNotifAt.current < THROTTLE_MS) return; // Throttle
      lastNotifAt.current = now;

      try {
        const notification = new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: `vibely-${now}`,
        });

        if (onClick) {
          notification.onclick = () => {
            window.focus();
            onClick();
            notification.close();
          };
        }

        // Auto-close after 10 seconds
        setTimeout(() => notification.close(), AUTO_CLOSE_MS);
      } catch {
        // Fail silently
      }
    },
    [isSupported, permission, isTabHidden]
  );

  const notifyMatch = useCallback(
    (partnerName: string, onNavigate?: () => void) => {
      sendNotification(
        "It's a match! 💚",
        `You matched with ${partnerName}! Tap to start your date.`,
        onNavigate
      );
    },
    [sendNotification]
  );

  const notifyReadyGateWaiting = useCallback(
    (partnerName: string, onNavigate?: () => void) => {
      sendNotification(
        'Your date is waiting!',
        `${partnerName} is ready — tap to join!`,
        onNavigate
      );
    },
    [sendNotification]
  );

  const notifyQueuedMatchReady = useCallback(
    (partnerName: string, onNavigate?: () => void) => {
      sendNotification(
        'Your match is ready! 💚',
        `${partnerName} is free — time to meet!`,
        onNavigate
      );
    },
    [sendNotification]
  );

  const notifySuperVibe = useCallback(
    (onNavigate?: () => void) => {
      sendNotification(
        'Someone really wants to meet you! ✨',
        'You received a Super Vibe — check your deck!',
        onNavigate
      );
    },
    [sendNotification]
  );

  return {
    isSupported,
    permission,
    isGranted: permission === 'granted',
    notifyMatch,
    notifyReadyGateWaiting,
    notifyQueuedMatchReady,
    notifySuperVibe,
  };
}
