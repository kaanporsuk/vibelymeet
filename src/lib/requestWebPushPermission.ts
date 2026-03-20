/**
 * OneSignal web push: request permission and sync player id to Supabase.
 * Use for Dashboard/Schedule flows (not raw Notification.requestPermission).
 */
import { supabase } from "@/integrations/supabase/client";
import { getPlayerId, promptForPush } from "@/lib/onesignal";

export async function requestWebPushPermissionAndSync(userId: string): Promise<boolean> {
  try {
    const granted = await promptForPush();
    if (!granted) return false;

    const playerId = await getPlayerId();

    if (!playerId) {
      console.warn("[requestWebPushPermission] granted but no player id (getPlayerId exhausted its retries)");
      return false;
    }

    const { error } = await supabase.from("notification_preferences").upsert(
      {
        user_id: userId,
        onesignal_player_id: playerId,
        onesignal_subscribed: true,
        push_enabled: true,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("[requestWebPushPermission] upsert failed:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[requestWebPushPermission] error:", err);
    return false;
  }
}
