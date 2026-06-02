/**
 * OneSignal web push: request permission and sync the browser subscription ID to Supabase.
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
const WEB_PLAYER_ID_LOGOUT_LOOKUP = {
  attempts: 2,
  initialDelayMs: 100,
  maxDelayMs: 250,
};
const WEB_PUSH_BACKEND_SYNC_TTL_MS = 10 * 60_000;
const WEB_PUSH_BACKEND_SYNC_CACHE_KEY = "vibely.web_push_backend_sync.v1";
const WEB_PUSH_SUBSCRIPTION_ID_CACHE_KEY = "vibely.web_push_subscription_id_by_user.v1";

const syncInFlightByUser = new Map<string, Promise<PushSyncResult>>();
const lastBackendSyncBySignature = new Map<
  string,
  { syncedAtMs: number; result: PushSyncResult }
>();

type StoredBackendSyncCache = Record<string, { syncedAtMs: number; result: PushSyncResult }>;
type StoredSubscriptionIdCache = Record<string, string>;
type PushSubscriptionRpcError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};
type PushSubscriptionRpcClient = {
  rpc: (
    fn: "register_onesignal_push_subscription" | "unregister_onesignal_push_subscription",
    args: Record<string, unknown>,
  ) => Promise<{ error: PushSubscriptionRpcError | null }>;
};

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

function readStoredBackendSyncCache(): StoredBackendSyncCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEB_PUSH_BACKEND_SYNC_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredBackendSyncCache)
      : {};
  } catch {
    return {};
  }
}

function writeStoredBackendSync(signature: string, result: PushSyncResult): void {
  if (typeof window === "undefined") return;
  try {
    const cache = readStoredBackendSyncCache();
    const cutoff = Date.now() - WEB_PUSH_BACKEND_SYNC_TTL_MS;
    for (const [key, value] of Object.entries(cache)) {
      if (!value || typeof value.syncedAtMs !== "number" || value.syncedAtMs < cutoff) {
        delete cache[key];
      }
    }
    cache[signature] = { syncedAtMs: Date.now(), result };
    window.localStorage.setItem(WEB_PUSH_BACKEND_SYNC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* localStorage is best-effort only */
  }
}

function readStoredSubscriptionIds(): StoredSubscriptionIdCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEB_PUSH_SUBSCRIPTION_ID_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredSubscriptionIdCache)
      : {};
  } catch {
    return {};
  }
}

function rememberWebPushSubscriptionId(userId: string, playerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = readStoredSubscriptionIds();
    next[userId] = playerId;
    window.localStorage.setItem(WEB_PUSH_SUBSCRIPTION_ID_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage is best-effort only */
  }
}

function readRememberedWebPushSubscriptionId(userId: string): string | null {
  const value = readStoredSubscriptionIds()[userId];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function forgetRememberedWebPushSubscriptionId(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = readStoredSubscriptionIds();
    delete next[userId];
    window.localStorage.setItem(WEB_PUSH_SUBSCRIPTION_ID_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage is best-effort only */
  }
}

function getFreshCachedBackendSync(signature: string): PushSyncResult | null {
  const cached = lastBackendSyncBySignature.get(signature);
  if (cached && Date.now() - cached.syncedAtMs <= WEB_PUSH_BACKEND_SYNC_TTL_MS) {
    return cached.result;
  }
  if (cached) {
    lastBackendSyncBySignature.delete(signature);
  }

  const stored = readStoredBackendSyncCache()[signature];
  if (!stored || Date.now() - stored.syncedAtMs > WEB_PUSH_BACKEND_SYNC_TTL_MS) return null;
  lastBackendSyncBySignature.set(signature, stored);
  return stored.result;
}

function pushSubscriptionRpc(): PushSubscriptionRpcClient {
  return supabase as unknown as PushSubscriptionRpcClient;
}

async function registerStoredWebPushSubscription(
  playerId: string,
  subscribed: boolean,
): Promise<string | null> {
  const { error } = await pushSubscriptionRpc().rpc("register_onesignal_push_subscription", {
    p_subscription_id: playerId,
    p_platform: "web",
    p_subscribed: subscribed,
  });

  return error?.message ?? null;
}

export async function disconnectWebPushForLogout(userId: string): Promise<void> {
  const livePlayerId = await getPlayerId(WEB_PLAYER_ID_LOGOUT_LOOKUP);
  const playerId = livePlayerId?.trim() || readRememberedWebPushSubscriptionId(userId);
  const { error } = await pushSubscriptionRpc().rpc("unregister_onesignal_push_subscription", {
    p_subscription_id: playerId,
    p_platform: "web",
  });

  if (error) {
    throw new Error(error.message ?? "push_subscription_unregister_failed");
  }
  forgetRememberedWebPushSubscriptionId(userId);
}

async function syncWebPushRegistrationToBackendInternal(userId: string): Promise<PushSyncResult> {
  if (typeof Notification === "undefined") {
    return syncResult("unsupported_browser");
  }
  if (Notification.permission !== "granted") {
    return syncResult(Notification.permission === "denied" ? "permission_denied" : "prompt_unavailable");
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
    rememberWebPushSubscriptionId(userId, playerId);
    return cachedResult;
  }

  const registerError = await registerStoredWebPushSubscription(playerId, subscribed);
  if (registerError) {
    vibelyOsLog("syncWebPushRegistrationToBackend:upsert failed", { message: registerError });
    console.error("[requestWebPushPermission] upsert failed:", registerError);
    return syncResult("upsert_failed", playerId, registerError);
  }

  rememberWebPushSubscriptionId(userId, playerId);
  if (!subscribed) {
    const result = syncResult("sdk_not_ready", playerId, "OneSignal subscription is not opted in yet.");
    lastBackendSyncBySignature.set(signature, { syncedAtMs: Date.now(), result });
    writeStoredBackendSync(signature, result);
    return result;
  }

  vibelyOsLog("syncWebPushRegistrationToBackend:success", {});
  const result = syncResult("synced", playerId);
  lastBackendSyncBySignature.set(signature, { syncedAtMs: Date.now(), result });
  writeStoredBackendSync(signature, result);
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
    const initialPermissionState = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    if (initialPermissionState === "unsupported" || initialPermissionState === "denied") {
      const result = syncResult(initialPermissionState === "unsupported" ? "unsupported_browser" : "permission_denied");
      recordPushDeliveryTelemetry("push_permission_prompt_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: initialPermissionState,
        sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
        sync_result_code: result.code,
      });
      recordPushDeliveryTelemetry("push_registration_sync_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: initialPermissionState,
        sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
        sync_result_code: result.code,
        local_player_present: false,
        backend_player_present: false,
        backend_subscribed: false,
      });
      return result;
    }
    if (initialPermissionState === "granted") {
      const result = await syncWebPushRegistrationToBackend(userId);
      recordPushDeliveryTelemetry("push_permission_prompt_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: initialPermissionState,
        sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
        sync_result_code: "prompt_granted",
      });
      recordPushDeliveryTelemetry("push_registration_sync_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: initialPermissionState,
        sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
        sync_result_code: result.code,
        local_player_present: Boolean(result.playerId),
        backend_player_present: result.synced,
        backend_subscribed: result.synced,
      });
      return result;
    }
    initOneSignal();
    const granted = await promptForPush();
    vibelyOsLog("requestWebPushPermission:after promptForPush", { granted });
    recordPushDeliveryTelemetry("push_permission_prompt_result", {
      platform: "web",
      surface: "permission_request",
      permission_state: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      sdk_status: getOneSignalWebClientSnapshot().sdkStatus,
      sync_result_code: granted ? "prompt_granted" : Notification.permission === "denied" ? "permission_denied" : "prompt_unavailable",
    });
    if (!granted) {
      const permissionState = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
      const result = syncResult(
        permissionState === "unsupported"
          ? "unsupported_browser"
          : permissionState === "denied"
            ? "permission_denied"
            : "prompt_unavailable",
      );
      recordPushDeliveryTelemetry("push_registration_sync_result", {
        platform: "web",
        surface: "permission_request",
        permission_state: permissionState,
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
