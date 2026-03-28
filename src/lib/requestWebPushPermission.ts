/**
 * OneSignal web push: request permission and sync player id to Supabase.
 * Use for Dashboard/Schedule flows (not raw Notification.requestPermission).
 */
import { supabase } from "@/integrations/supabase/client";
import { getPlayerId, promptForPush } from "@/lib/onesignal";
import { vibelyOsLog } from "@/lib/onesignalWebDiagnostics";

export async function requestWebPushPermissionAndSync(userId: string): Promise<boolean> {
  try {
    vibelyOsLog("requestWebPushPermission:start", { userIdTail: userId.slice(-6) });
    const granted = await promptForPush();
    vibelyOsLog("requestWebPushPermission:after promptForPush", { granted });
    if (!granted) return false;

    const playerId = await getPlayerId();
    vibelyOsLog("requestWebPushPermission:after getPlayerId", { hasPlayerId: Boolean(playerId) });

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
      vibelyOsLog("requestWebPushPermission:upsert failed", { message: error.message });
      console.error("[requestWebPushPermission] upsert failed:", error);
      return false;
    }

    vibelyOsLog("requestWebPushPermission:success", {});
    return true;
  } catch (err) {
    vibelyOsLog("requestWebPushPermission:catch", { error: String(err) });
    console.error("[requestWebPushPermission] error:", err);
    return false;
  }
}
