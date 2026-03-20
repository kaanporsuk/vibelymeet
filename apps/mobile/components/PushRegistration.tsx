import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { initOneSignal, syncPushWithBackendIfPermissionGranted, logoutOneSignal } from '@/lib/onesignal';

/**
 * Initializes OneSignal. On login, only syncs player ID to the backend if the user
 * already granted notification permission (no prompt on every app open).
 */
export function PushRegistration() {
  const { user, session } = useAuth();

  useEffect(() => {
    initOneSignal();
  }, []);

  useEffect(() => {
    if (!user?.id || !session) {
      logoutOneSignal();
      return;
    }
    syncPushWithBackendIfPermissionGranted(user.id).catch(() => {});
  }, [user?.id, session]);

  return null;
}
