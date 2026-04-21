import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { initOneSignal, logoutOneSignal, bindOneSignalExternalUser, setOneSignalTags } from '@/lib/onesignal';
import { syncNativePushDeliveryOnForeground } from '@/lib/nativePushForegroundSync';
import { pushPermDevLog } from '@/lib/osPushPermission';

/**
 * Initializes OneSignal. On login, only syncs player ID to the backend if the user
 * already granted notification permission (no prompt on every app open).
 *
 * Tags `is_premium` + `subscription_tier` use the same native sources as settings display:
 * useBackendSubscription (subscriptions row + profiles.is_premium) and useEntitlements (profiles.subscription_tier).
 */
export function PushRegistration() {
  const { user, onboardingComplete } = useAuth();
  const { tierId, isLoading: entLoading } = useEntitlements();
  const { isPremium, isLoading: subLoading } = useBackendSubscription(user?.id);
  const foregroundSyncInFlightRef = useRef(false);
  const foregroundSyncUserIdRef = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    initOneSignal();
  }, []);

  const runForegroundSync = useCallback(
    (reason: string) => {
      if (!user?.id) return;
      if (foregroundSyncInFlightRef.current && foregroundSyncUserIdRef.current === user.id) {
        if (__DEV__) {
          pushPermDevLog('PushRegistration foreground sync skipped', {
            userId: user.id,
            reason,
            skipReason: 'foreground_sync_ref_in_flight',
          });
        }
        return;
      }
      foregroundSyncInFlightRef.current = true;
      foregroundSyncUserIdRef.current = user.id;
      syncNativePushDeliveryOnForeground(user.id, reason)
        .catch(() => {})
        .finally(() => {
          if (foregroundSyncUserIdRef.current === user.id) {
            foregroundSyncInFlightRef.current = false;
            foregroundSyncUserIdRef.current = null;
          }
        });
    },
    [user?.id],
  );

  useEffect(() => {
    if (!user?.id) {
      logoutOneSignal();
      return;
    }
    bindOneSignalExternalUser(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (!entLoading && !subLoading) {
      setOneSignalTags({
        userId: user.id,
        onboardingComplete: onboardingComplete === true,
        isPremium,
        subscriptionTier: tierId,
      });
    }
  }, [
    user?.id,
    onboardingComplete,
    entLoading,
    subLoading,
    isPremium,
    tierId,
  ]);

  useEffect(() => {
    runForegroundSync('auth_user_ready');
  }, [runForegroundSync]);

  useEffect(() => {
    if (!user?.id) return;
    const onChange = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === next || next !== 'active') return;
      runForegroundSync('appstate_active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user?.id, runForegroundSync]);

  return null;
}
