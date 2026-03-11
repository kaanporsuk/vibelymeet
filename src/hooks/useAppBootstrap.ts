import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { setExternalUserId, removeExternalUserId, getPlayerId, isSubscribed } from "@/lib/onesignal";
import { identifyUser, resetAnalytics, setUserProperties } from "@/lib/analytics";

export const useAppBootstrap = () => {
  const { session } = useAuth();
  const { user } = useUserProfile();

  // Auth-linked identities: Sentry + analytics + OneSignal
  useEffect(() => {
    const currentUser = session?.user;

    if (!currentUser) {
      Sentry.setUser(null);
      resetAnalytics();
      removeExternalUserId();
      return;
    }

    Sentry.setUser({ id: currentUser.id });
    identifyUser(currentUser.id, {
      email: currentUser.email,
      created_at: currentUser.created_at,
    });

    const syncOneSignal = async () => {
      try {
        setExternalUserId(currentUser.id);
        const playerId = await getPlayerId();
        const subscribed = await isSubscribed();
        if (playerId) {
          await supabase
            .from("notification_preferences")
            .upsert(
              {
                user_id: currentUser.id,
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
  }, [session?.user]);

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

