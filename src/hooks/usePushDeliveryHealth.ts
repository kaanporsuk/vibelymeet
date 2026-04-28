import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOneSignalWebClientSnapshot, getPlayerId } from "@/lib/onesignal";
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
};

const EMPTY_BACKEND_ROW: BackendPushRow = {
  playerId: null,
  subscribed: false,
};

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
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("onesignal_player_id, onesignal_subscribed")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("[push-health] Failed to read web push backend row:", error.message);
      return;
    }
    if (!mountedRef.current) return;
    setBackend({
      playerId: data?.onesignal_player_id ?? null,
      subscribed: data?.onesignal_subscribed ?? false,
    });
  }, [user?.id]);

  const refreshLocalPlayer = useCallback(async () => {
    const snapshot = getOneSignalWebClientSnapshot();
    if (snapshot.sdkStatus !== "ready") {
      setLocalPlayerId(null);
      return;
    }
    const id = await getPlayerId({ attempts: 1, initialDelayMs: 0, maxDelayMs: 0 });
    if (!mountedRef.current) return;
    setLocalPlayerId(id);
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
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void sync();
      } else {
        void refresh();
      }
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
      syncInFlight,
      lastSyncResultCode,
    });
  }, [
    backend.playerId,
    backend.subscribed,
    isOneSignalSubscribed,
    isSupported,
    lastSyncResultCode,
    localPlayerId,
    permission,
    syncInFlight,
  ]);

  return {
    health,
    sync,
    refresh,
    isSyncing: syncInFlight,
  };
}
