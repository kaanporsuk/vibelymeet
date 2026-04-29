/**
 * OneSignal web push: request permission and sync player id to Supabase.
 * Use for Dashboard/Schedule flows (not raw Notification.requestPermission).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getOneSignalWebClientSnapshot,
  getPlayerId,
  isCurrentOneSignalIdentity,
  isSubscribed,
  promptForPush,
  setExternalUserId,
  waitForOneSignalInitResult,
} from "@/lib/onesignal";
import { vibelyOsLog } from "@/lib/onesignalWebDiagnostics";
import { recordPushDeliveryTelemetry } from "@/lib/pushDeliveryTelemetry";
import type { PushSyncResult } from "@clientShared/pushDeliveryHealth";

const WEB_PLAYER_ID_SYNC_RETRY = {
  attempts: 12,
  initialDelayMs: 500,
  maxDelayMs: 5000,
};

function syncResult(
  code: PushSyncResult["code"],
  playerId: string | null = null,
  message?: string,
): PushSyncResult {
  return { code, synced: code === "synced", playerId, message };
}

export async function syncWebPushRegistrationToBackend(userId: string): Promise<PushSyncResult> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return syncResult("permission_denied");
  }

  const snapshot = getOneSignalWebClientSnapshot();
  if (!snapshot.appIdConfigured) return syncResult("app_id_missing");

  const generation = setExternalUserId(userId);
  const init = await waitForOneSignalInitResult();
  if (init.sdkStatus === "init_failed") return syncResult("init_failed");
  if (!init.sdkUsable) return syncResult("sdk_not_ready");
  if (!isCurrentOneSignalIdentity(userId, generation)) return syncResult("stale_identity");

  const playerId = await getPlayerId(WEB_PLAYER_ID_SYNC_RETRY);
  vibelyOsLog("syncWebPushRegistrationToBackend:after getPlayerId", { hasPlayerId: Boolean(playerId) });
  if (!isCurrentOneSignalIdentity(userId, generation)) return syncResult("stale_identity", playerId);
  if (!playerId) {
    return syncResult("no_player_id_after_retry");
  }

  const subscribed = await isSubscribed();
  if (!isCurrentOneSignalIdentity(userId, generation)) return syncResult("stale_identity", playerId);

  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: userId,
      onesignal_player_id: playerId,
      onesignal_subscribed: subscribed,
      push_enabled: true,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    vibelyOsLog("syncWebPushRegistrationToBackend:upsert failed", { message: error.message });
    console.error("[requestWebPushPermission] upsert failed:", error);
    return syncResult("upsert_failed", playerId, error.message);
  }

  if (!subscribed) {
    return syncResult("sdk_not_ready", playerId, "OneSignal subscription is not opted in yet.");
  }

  vibelyOsLog("syncWebPushRegistrationToBackend:success", {});
  return syncResult("synced", playerId);
}

export async function requestWebPushPermissionAndSync(userId: string): Promise<PushSyncResult> {
  try {
    vibelyOsLog("requestWebPushPermission:start", { userIdTail: userId.slice(-6) });
    const granted = await promptForPush();
    vibelyOsLog("requestWebPushPermission:after promptForPush", { granted });
    recordPushDeliveryTelemetry("push_permission_prompt_result", {
      platform: "web",
      surface: "permission_request",
      permission_state: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
      sync_result_code: granted ? "prompt_granted" : "permission_denied",
    });
    if (!granted) {
      const result = syncResult("permission_denied");
      recordPushDeliveryTelemetry("push_registration_sync_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
        sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
        sync_result_code: result.code,
        local_player_present: false,
        backend_player_present: false,
        backend_subscribed: false,
      });
      return result;
    }
    const result = await syncWebPushRegistrationToBackend(userId);
    recordPushDeliveryTelemetry("push_registration_sync_result", {
      platform: "web",
      surface: "permission_request",
      permission_state: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
      sync_result_code: result.code,
      local_player_present: Boolean(result.playerId),
      backend_player_present: result.synced,
      backend_subscribed: result.synced,
    });
    return result;
  } catch (err) {
    vibelyOsLog("requestWebPushPermission:catch", { error: String(err) });
    console.error("[requestWebPushPermission] error:", err);
    const result = syncResult("upsert_failed", null, err instanceof Error ? err.message : String(err));
    recordPushDeliveryTelemetry("push_registration_sync_result", {
      platform: "web",
      surface: "permission_request",
      permission_state: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
      sync_result_code: result.code,
      local_player_present: false,
      backend_player_present: false,
      backend_subscribed: false,
    });
    return result;
  }
}
