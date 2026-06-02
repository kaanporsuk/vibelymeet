import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOneSignalWebClientSnapshot, getPlayerId } from "@/lib/onesignal";
import { recordPushDeliveryTelemetry } from "@/lib/pushDeliveryTelemetry";
import { syncWebPushRegistrationToBackend } from "@/lib/requestWebPushPermission";
import { useUserProfile } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  resolvePushDeliveryHealth,
  type PushDeliveryHealth,
  type PushPermissionHealth,
  type PushSdkHealth,
  type PushSyncResult,
  type PushSyncResultCode,
} from "@clientShared/pushDeliveryHealth";

type BackendPushRow = {
  playerId: string | null;
  subscribed: boolean | null;
  pushEnabled: boolean | null;
  pausedUntil: string | null;
};

type BackendPushSubscriptionRow = {
  subscription_id: string | null;
  subscribed: boolean | null;
};

const EMPTY_BACKEND_ROW: BackendPushRow = {
  playerId: null,
  subscribed: false,
  pushEnabled: true,
  pausedUntil: null,
};

function isMissingPushSubscriptionsRelation(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  const haystack = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /42P01|PGRST205|push_subscriptions|relation .* does not exist|Could not find the table/i.test(haystack);
}

function rowToBackendSubscription(row: BackendPushSubscriptionRow | null | undefined): Pick<BackendPushRow, "playerId" | "subscribed"> | null {
  const playerId = typeof row?.subscription_id === "string" && row.subscription_id.trim()
    ? row.subscription_id.trim()
    : null;
  if (!playerId) return null;
  return {
    playerId,
    subscribed: row?.subscribed === true,
  };
}

async function getCurrentWebPlayerId(): Promise<string | null> {
  const snapshot = getOneSignalWebClientSnapshot();
  if (snapshot.sdkStatus !== "ready") return null;
  return getPlayerId({ attempts: 1, initialDelayMs: 0, maxDelayMs: 0 });
}

async function readBackendPushSubscription(userId: string, localPlayerId: string | null): Promise<Pick<BackendPushRow, "playerId" | "subscribed"> | null> {
  const subscriptionId = localPlayerId?.trim() || null;
  if (!subscriptionId) return null;

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("subscription_id, subscribed")
    .eq("user_id", userId)
    .eq("provider", "onesignal")
    .eq("subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    if (!isMissingPushSubscriptionsRelation(error)) {
      console.warn("[push-health] Failed to read web push subscription row:", error.message);
    }
    return null;
  }

  return rowToBackendSubscription(data);
}

function permissionToHealth(permission: NotificationPermission, supported: boolean): PushPermissionHealth {
  if (!supported) return "unsupported";
  if (permission === "granted") return "granted";
  if (permission === "denied") return "denied";
  return "default";
}

export function usePushDeliveryHealth() {
  const { user } = useUserProfile();
  const {
    isSupported,
    permission,
    isOneSignalSubscribed,
    refreshSubscriptionState,
  } = usePushNotifications();
  const [backend, setBackend] = useState<BackendPushRow>(EMPTY_BACKEND_ROW);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [syncInFlight, setSyncInFlight] = useState(false);
  const [lastSyncResultCode, setLastSyncResultCode] = useState<PushSyncResultCode | null>(null);
  const mountedRef = useRef(true);
  const lastObservedHealthRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshBackend = useCallback(async () => {
    if (!user?.id) {
      setBackend(EMPTY_BACKEND_ROW);
      return;
    }
    const [localId, prefsResult] = await Promise.all([
      getCurrentWebPlayerId(),
      supabase
        .from("notification_preferences")
        .select("push_enabled, paused_until")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const { data, error } = prefsResult;
    if (error) {
      console.warn("[push-health] Failed to read web push backend row:", error.message);
      return;
    }
    const currentSubscriptionId = localId?.trim() || null;
    const normalized = await readBackendPushSubscription(user.id, currentSubscriptionId);
    if (!mountedRef.current) return;
    setBackend({
      playerId: normalized?.playerId ?? null,
      subscribed: normalized?.subscribed ?? false,
      pushEnabled: data?.push_enabled ?? true,
      pausedUntil: data?.paused_until ?? null,
    });
  }, [user?.id]);

  const refreshLocalPlayer = useCallback(async () => {
    const snapshot = getOneSignalWebClientSnapshot();
    if (snapshot.sdkStatus !== "ready") {
      setLocalPlayerId(null);
      return;
    }
    const id = await getCurrentWebPlayerId();
    if (!mountedRef.current) return;
    setLocalPlayerId(id?.trim() || null);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshSubscriptionState(),
      refreshBackend(),
      refreshLocalPlayer(),
    ]);
  }, [refreshBackend, refreshLocalPlayer, refreshSubscriptionState]);

  const sync = useCallback(async (): Promise<PushSyncResult | null> => {
    if (!user?.id) return null;
    setSyncInFlight(true);
    try {
      const result = await syncWebPushRegistrationToBackend(user.id);
      if (mountedRef.current) setLastSyncResultCode(result.code);
      await refresh();
      return result;
    } finally {
      if (mountedRef.current) setSyncInFlight(false);
    }
  }, [refresh, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => {
      void sync();
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("vibely-onesignal-subscription-changed", onChanged);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("vibely-onesignal-subscription-changed", onChanged);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, sync]);

  const health: PushDeliveryHealth = useMemo(() => {
    const snapshot = getOneSignalWebClientSnapshot();
    const sdk: PushSdkHealth = snapshot.sdkStatus;
    return resolvePushDeliveryHealth({
      platform: "web",
      permission: permissionToHealth(permission, isSupported),
      sdk,
      sdkSubscribed: isOneSignalSubscribed,
      localPlayerId,
      backendPlayerId: backend.playerId,
      backendSubscribed: backend.subscribed,
      preferencesEnabled: backend.pushEnabled,
      pausedUntil: backend.pausedUntil,
      syncInFlight,
      lastSyncResultCode,
    });
  }, [
    backend.playerId,
    backend.pausedUntil,
    backend.pushEnabled,
    backend.subscribed,
    isOneSignalSubscribed,
    isSupported,
    lastSyncResultCode,
    localPlayerId,
    permission,
    syncInFlight,
  ]);

  useEffect(() => {
    const signature = [
      health.status,
      health.permission,
      health.sdk,
      health.lastSyncResultCode ?? "none",
      Boolean(health.localPlayerId),
      Boolean(health.backendPlayerId),
      health.backendSubscribed === true,
      health.preferencesEnabled !== false,
      health.pausedUntil ?? "none",
    ].join("|");
    if (lastObservedHealthRef.current === signature) return;
    lastObservedHealthRef.current = signature;
    recordPushDeliveryTelemetry("push_delivery_health_observed", {
      platform: "web",
      surface: "push_delivery_health",
      permission_state: health.permission,
      sdk_status: health.sdk,
      client_health_status: health.status,
      sync_result_code: health.lastSyncResultCode ?? "none",
      local_player_present: Boolean(health.localPlayerId),
      backend_player_present: Boolean(health.backendPlayerId),
      backend_subscribed: health.backendSubscribed === true,
      preferences_enabled: health.preferencesEnabled !== false,
      paused: Boolean(health.pausedUntil && new Date(health.pausedUntil).getTime() > Date.now()),
    });
  }, [health]);

  return {
    health,
    sync,
    refresh,
    isSyncing: syncInFlight,
  };
}
