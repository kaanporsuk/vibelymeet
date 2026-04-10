import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useBackendSubscription } from '@/lib/subscriptionApi';
import { initOneSignal, logoutOneSignal, bindOneSignalExternalUser, setOneSignalTags } from '@/lib/onesignal';
import { syncNativePushDeliveryOnForeground } from '@/lib/nativePushForegroundSync';

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

  useEffect(() => {
    initOneSignal();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      logoutOneSignal();
      return;
    }
    bindOneSignalExternalUser(user.id);
    if (!entLoading && !subLoading) {
      setOneSignalTags({
        userId: user.id,
        onboardingComplete: onboardingComplete === true,
        isPremium,
        subscriptionTier: tierId,
      });
    }
    syncNativePushDeliveryOnForeground(user.id).catch(() => {});
  }, [
    user?.id,
    onboardingComplete,
    entLoading,
    subLoading,
    isPremium,
    tierId,
  ]);

  useEffect(() => {
    if (!user?.id) return;
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      syncNativePushDeliveryOnForeground(user.id).catch(() => {});
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [user?.id]);

  return null;
}
