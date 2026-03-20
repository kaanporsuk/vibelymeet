import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { clearExpiredPauseIfNeeded } from '@/lib/notificationPause';
import { clearExpiredDiscoverySnoozeIfNeeded } from '@/lib/discoverySnooze';
import { useAuth } from '@/context/AuthContext';

/**
 * On foreground: notification pause expiry + discovery snooze expiry (same moment as pause check).
 */
export function NotificationPauseForeground() {
  const qc = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    const run = async () => {
      await clearExpiredPauseIfNeeded();
      await clearExpiredDiscoverySnoozeIfNeeded(user?.id);
      qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      qc.invalidateQueries({ queryKey: ['privacy-profile', user?.id] });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void run();
    });

    return () => sub.remove();
  }, [qc, user?.id]);

  return null;
}
