import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { clearExpiredPauseIfNeeded } from '@/lib/notificationPause';

/**
 * On foreground: if notification pause expired, re-enable OneSignal and clear prefs + storage.
 */
export function NotificationPauseForeground() {
  const qc = useQueryClient();

  useEffect(() => {
    const run = async () => {
      await clearExpiredPauseIfNeeded();
      qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void run();
    });

    return () => sub.remove();
  }, [qc]);

  return null;
}
