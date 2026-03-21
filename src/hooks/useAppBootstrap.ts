import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { setExternalUserId, removeExternalUserId, getPlayerId, isSubscribed } from "@/lib/onesignal";
import { identifyUser, resetAnalytics, setUserProperties } from "@/lib/analytics";

export const useAppBootstrap = () => {
  const { session } = useAuth();
  const { user } = useUserProfile();

  // Auth-linked identities: Sentry + analytics + OneSignal.
  // Depend on stable user id (not session?.user object) so TOKEN_REFRESHED / session refresh
  // does not re-fire OneSignal login + DB sync on every page.
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email;
  const userCreatedAt = session?.user?.created_at;

  useEffect(() => {
    if (!userId) {
      Sentry.setUser(null);
      resetAnalytics();
      removeExternalUserId();
      return;
    }

    Sentry.setUser({ id: userId });
    identifyUser(userId, {
      email: userEmail,
      created_at: userCreatedAt,
    });

    const syncOneSignal = async () => {
      try {
        setExternalUserId(userId);
        const playerId = await getPlayerId();
        const subscribed = await isSubscribed();
        if (playerId) {
          await supabase
            .from("notification_preferences")
            .upsert(
              {
                user_id: userId,
                onesignal_player_id: playerId,
                onesignal_subscribed: subscribed,
              },
              { onConflict: "user_id" }
            );
        }
      } catch (e) {
        console.error("OneSignal sync error:", e);
      }
    };

    void syncOneSignal();
  }, [userId, userEmail, userCreatedAt]);

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
      is_verified: user.isVerified,
    });
  }, [user]);
};

