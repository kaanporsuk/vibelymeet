/**
 * OneSignal web push: request permission and sync player id to Supabase.
 * Use for Dashboard/Schedule flows (not raw Notification.requestPermission).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getOneSignalWebClientSnapshot,
  getPlayerId,
  initOneSignal,
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
const WEB_PUSH_BACKEND_SYNC_TTL_MS = 10 * 60_000;

const syncInFlightByUser = new Map<string, Promise<PushSyncResult>>();
const lastBackendSyncBySignature = new Map<
  string,
  { syncedAtMs: number; result: PushSyncResult }
>();

function syncResult(
  code: PushSyncResult["code"],
  playerId: string | null = null,
  message?: string,
): PushSyncResult {
  return { code, synced: code === "synced", playerId, message };
}

function backendSyncSignature(userId: string, playerId: string, subscribed: boolean): string {
  return `${userId}:${playerId}:${subscribed ? "subscribed" : "unsubscribed"}`;
}

function getFreshCachedBackendSync(signature: string): PushSyncResult | null {
  const cached = lastBackendSyncBySignature.get(signature);
  if (!cached) return null;
  if (Date.now() - cached.syncedAtMs > WEB_PUSH_BACKEND_SYNC_TTL_MS) {
    lastBackendSyncBySignature.delete(signature);
    return null;
  }
  return cached.result;
}

async function syncWebPushRegistrationToBackendInternal(userId: string): Promise<PushSyncResult> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return syncResult("permission_denied");
  }

  const snapshot = getOneSignalWebClientSnapshot();
  if (!snapshot.appIdConfigured) return syncResult("app_id_missing");

  initOneSignal();
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

  const signature = backendSyncSignature(userId, playerId, subscribed);
  const cachedResult = getFreshCachedBackendSync(signature);
  if (cachedResult) {
    vibelyOsLog("syncWebPushRegistrationToBackend:skip duplicate backend sync", {
      subscribed,
      code: cachedResult.code,
    });
    return cachedResult;
  }

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
    const result = syncResult("sdk_not_ready", playerId, "OneSignal subscription is not opted in yet.");
    lastBackendSyncBySignature.set(signature, { syncedAtMs: Date.now(), result });
    return result;
  }

  vibelyOsLog("syncWebPushRegistrationToBackend:success", {});
  const result = syncResult("synced", playerId);
  lastBackendSyncBySignature.set(signature, { syncedAtMs: Date.now(), result });
  return result;
}

export async function syncWebPushRegistrationToBackend(userId: string): Promise<PushSyncResult> {
  const inFlight = syncInFlightByUser.get(userId);
  if (inFlight) return inFlight;

  const task = syncWebPushRegistrationToBackendInternal(userId).finally(() => {
    syncInFlightByUser.delete(userId);
  });
  syncInFlightByUser.set(userId, task);
  return task;
}

export async function requestWebPushPermissionAndSync(userId: string): Promise<PushSyncResult> {
  try {
    vibelyOsLog("requestWebPushPermission:start", { userIdTail: userId.slice(-6) });
    initOneSignal();
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
