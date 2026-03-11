import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { initOneSignal, registerPushWithBackend, logoutOneSignal } from '@/lib/onesignal';

/**
 * Initializes OneSignal and registers this device for push when user is logged in.
 * On sign out, clears OneSignal external id so backend no longer targets this device
 * for that user (actual DB row is left; backend uses mobile_onesignal_subscribed which
 * we could clear on logout if desired — for now we leave it for simplicity).
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
    registerPushWithBackend(user.id).catch(() => {});
  }, [user?.id, session]);

  return null;
}
