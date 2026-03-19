import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { initOneSignal, registerPushWithBackend, logoutOneSignal, setOneSignalTags } from '@/lib/onesignal';
import { supabase } from '@/lib/supabase';

/**
 * Initializes OneSignal and registers this device for push when user is logged in.
 * Sets OneSignal tags for segmentation (welcome flow, profile nudge, re-engagement).
 * On sign out, clears OneSignal external id.
 */
export function PushRegistration() {
  const { user, session, onboardingComplete } = useAuth();

  useEffect(() => {
    initOneSignal();
  }, []);

  useEffect(() => {
    if (!user?.id || !session) {
      logoutOneSignal();
      return;
    }
    let cancelled = false;
    (async () => {
      await registerPushWithBackend(user.id).catch(() => {});
      if (cancelled) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('photos, is_premium, created_at, location')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || !profile) return;
      const row = profile as { photos?: string[] | null; is_premium?: boolean; created_at?: string; location?: string | null };
      setOneSignalTags({
        userId: user.id,
        onboardingComplete: onboardingComplete === true,
        hasPhotos: (row.photos?.length ?? 0) > 0,
        isPremium: row.is_premium === true,
        city: row.location ?? '',
        signupDate: row.created_at ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, session, onboardingComplete]);

  return null;
}
