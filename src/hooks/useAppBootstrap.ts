import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { identifyUser, resetAnalytics, setUserProperties } from "@/lib/analytics";

export const useAppBootstrap = () => {
  const { session, isLoading } = useAuth();
  const { user } = useUserProfile();

  // Auth-linked identities: Sentry + analytics + OneSignal.
  // Depend on stable user id (not session?.user object) so TOKEN_REFRESHED / session refresh
  // does not re-fire OneSignal login + DB sync on every page.
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email;
  const userCreatedAt = session?.user?.created_at;

  useEffect(() => {
    if (isLoading) return;
    if (!userId) {
      Sentry.setUser(null);
      resetAnalytics();
      void import("@/lib/onesignal").then(({ removeExternalUserId }) => {
        removeExternalUserId();
      });
      return;
    }

    Sentry.setUser({ id: userId });
    identifyUser(userId, {
      email: userEmail,
      created_at: userCreatedAt,
    });

    let cancelled = false;
    const syncOneSignal = async () => {
      try {
        const [{ initOneSignal, setExternalUserId }, { syncWebPushRegistrationToBackend }] =
          await Promise.all([
            import("@/lib/onesignal"),
            import("@/lib/requestWebPushPermission"),
          ]);
        if (cancelled) return;
        initOneSignal();
        setExternalUserId(userId);
        await syncWebPushRegistrationToBackend(userId);
      } catch (e) {
        console.error("OneSignal sync error:", e);
      }
    };

    void syncOneSignal();
    const retrySyncOnLateOneSignalInit = (event: Event) => {
      const sdkUsable = Boolean((event as CustomEvent<{ sdkUsable?: boolean }>).detail?.sdkUsable);
      if (sdkUsable) void syncOneSignal();
    };
    window.addEventListener("vibely-onesignal-init-settled", retrySyncOnLateOneSignalInit);
    return () => {
      cancelled = true;
      window.removeEventListener("vibely-onesignal-init-settled", retrySyncOnLateOneSignalInit);
    };
  }, [isLoading, userId, userEmail, userCreatedAt]);

  // Profile-linked analytics properties
  useEffect(() => {
    if (!user) return;

    setUserProperties({
      name: user.name,
      age: user.age ?? undefined,
      gender: user.gender ?? undefined,
      location: user.location ?? undefined,
      has_photos: user.hasPhotos,
      is_premium: user.isPremium,
      subscription_tier: user.subscriptionTier ?? undefined,
      is_verified: user.isVerified,
    });
  }, [user]);
};
