import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  initOneSignal,
  syncPushWithBackendIfPermissionGranted,
  logoutOneSignal,
  bindOneSignalExternalUser,
  setOneSignalTags,
} from '@/lib/onesignal';
import { syncNativePushSuppressionWithBackend } from '@/lib/notificationPause';

/**
 * Initializes OneSignal. On login, only syncs player ID to the backend if the user
 * already granted notification permission (no prompt on every app open).
 */
export function PushRegistration() {
  const { user, onboardingComplete } = useAuth();

  useEffect(() => {
    initOneSignal();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      logoutOneSignal();
      return;
    }
    bindOneSignalExternalUser(user.id);
    setOneSignalTags({
      userId: user.id,
      onboardingComplete: onboardingComplete === true,
    });
    syncPushWithBackendIfPermissionGranted(user.id)
      .then(() => syncNativePushSuppressionWithBackend(user.id))
      .catch(() => {});
  }, [user?.id, onboardingComplete]);

  return null;
}
