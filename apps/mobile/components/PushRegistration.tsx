import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { initOneSignal, syncPushWithBackendIfPermissionGranted, logoutOneSignal } from '@/lib/onesignal';
import { syncNativePushSuppressionWithBackend } from '@/lib/notificationPause';

/**
 * Initializes OneSignal. On login, only syncs player ID to the backend if the user
 * already granted notification permission (no prompt on every app open).
 */
export function PushRegistration() {
  const { user } = useAuth();

  useEffect(() => {
    initOneSignal();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      logoutOneSignal();
      return;
    }
    syncPushWithBackendIfPermissionGranted(user.id)
      .then(() => syncNativePushSuppressionWithBackend(user.id))
      .catch(() => {});
  }, [user?.id]);

  return null;
}
