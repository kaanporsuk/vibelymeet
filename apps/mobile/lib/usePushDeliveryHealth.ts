import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { usePushPermission } from '@/lib/usePushPermission';
import {
  getCurrentNativePlayerId,
  getCurrentNativePushSubscribed,
  getNativeOneSignalClientSnapshot,
  syncPushWithBackendIfPermissionGranted,
} from '@/lib/onesignal';
import { syncNativePushSuppressionWithBackend } from '@/lib/notificationPause';
import { recordPushDeliveryTelemetry } from '@/lib/pushDeliveryTelemetry';
import {
  resolvePushDeliveryHealth,
  type PushDeliveryHealth,
  type PushPermissionHealth,
  type PushSyncResult,
  type PushSyncResultCode,
} from '@clientShared/pushDeliveryHealth';

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
  const haystack = `${error?.code ?? ''} ${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`;
  return /42P01|PGRST205|push_subscriptions|relation .* does not exist|Could not find the table/i.test(haystack);
}

function rowToBackendSubscription(row: BackendPushSubscriptionRow | null | undefined): Pick<BackendPushRow, 'playerId' | 'subscribed'> | null {
  const playerId = typeof row?.subscription_id === 'string' && row.subscription_id.trim()
    ? row.subscription_id.trim()
    : null;
  if (!playerId) return null;
  return {
    playerId,
    subscribed: row?.subscribed === true,
  };
}

async function readBackendPushSubscription(userId: string, localPlayerId: string | null): Promise<Pick<BackendPushRow, 'playerId' | 'subscribed'> | null> {
  const subscriptionId = localPlayerId?.trim() || null;
  if (!subscriptionId) return null;

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('subscription_id, subscribed')
    .eq('user_id', userId)
    .eq('provider', 'onesignal')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (error) {
    if (!isMissingPushSubscriptionsRelation(error)) {
      if (__DEV__) console.warn('[push-health] Failed to read native push subscription row:', error.message);
    }
    return null;
  }

  return rowToBackendSubscription(data as BackendPushSubscriptionRow | null);
}

function permissionToHealth(status: string): PushPermissionHealth {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  if (status === 'undetermined') return 'undetermined';
  if (status === 'unknown') return 'unknown';
  return 'unknown';
}

export function usePushDeliveryHealth(userId: string | null | undefined) {
  const { osStatus, refresh: refreshPermission } = usePushPermission();
  const [backend, setBackend] = useState<BackendPushRow>(EMPTY_BACKEND_ROW);
  const [localPlayerId, setLocalPlayerId] = useState<string | null>(null);
  const [sdkSubscribed, setSdkSubscribed] = useState<boolean | null>(null);
  const [syncInFlight, setSyncInFlight] = useState(false);
  const [lastSyncResultCode, setLastSyncResultCode] = useState<PushSyncResultCode | null>(null);
  const mountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastObservedHealthRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshBackend = useCallback(async () => {
    if (!userId) {
      setBackend(EMPTY_BACKEND_ROW);
      return;
    }
    const [localId, prefsResult] = await Promise.all([
      getCurrentNativePlayerId(),
      supabase
        .from('notification_preferences')
        .select('mobile_onesignal_player_id, mobile_onesignal_subscribed, push_enabled, paused_until')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    const { data, error } = prefsResult;
    if (error) {
      if (__DEV__) console.warn('[push-health] Failed to read native push backend row:', error.message);
      return;
    }
    const currentSubscriptionId = localId?.trim() || null;
    const normalized = await readBackendPushSubscription(userId, currentSubscriptionId);
    if (!mountedRef.current) return;
    const legacyPlayerId =
      typeof data?.mobile_onesignal_player_id === 'string' && data.mobile_onesignal_player_id.trim()
        ? data.mobile_onesignal_player_id.trim()
        : null;
    const legacyMatchesCurrentDevice =
      !currentSubscriptionId || !legacyPlayerId || legacyPlayerId === currentSubscriptionId;
    const legacySubscribed = legacyMatchesCurrentDevice
      ? (data?.mobile_onesignal_subscribed as boolean | null | undefined) ?? false
      : false;
    setBackend({
      playerId: normalized?.playerId ?? (legacyMatchesCurrentDevice ? legacyPlayerId : null),
      subscribed: normalized?.subscribed ?? legacySubscribed,
      pushEnabled: (data?.push_enabled as boolean | null | undefined) ?? true,
      pausedUntil: (data?.paused_until as string | null | undefined) ?? null,
    });
  }, [userId]);

  const refreshLocal = useCallback(async () => {
    const [playerId, optedIn] = await Promise.all([
      getCurrentNativePlayerId(),
      getCurrentNativePushSubscribed(),
    ]);
    if (!mountedRef.current) return;
    setLocalPlayerId(playerId?.trim() || null);
    setSdkSubscribed(optedIn);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshPermission('push_delivery_health'),
      refreshBackend(),
      refreshLocal(),
    ]);
  }, [refreshBackend, refreshLocal, refreshPermission]);

  const sync = useCallback(async (): Promise<PushSyncResult | null> => {
    if (!userId) return null;
    setSyncInFlight(true);
    try {
      await syncNativePushSuppressionWithBackend(userId);
      const result = await syncPushWithBackendIfPermissionGranted(userId);
      if (mountedRef.current) setLastSyncResultCode(result.code);
      await refresh();
      return result;
    } finally {
      if (mountedRef.current) setSyncInFlight(false);
    }
  }, [refresh, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const onChange = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === next || next !== 'active') return;
      if (osStatus === 'granted') {
        void sync();
      } else {
        void refresh();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [osStatus, refresh, sync, userId]);

  const health: PushDeliveryHealth = useMemo(() => {
    const snapshot = getNativeOneSignalClientSnapshot();
    return resolvePushDeliveryHealth({
      platform: 'native',
      permission: permissionToHealth(osStatus),
      sdk: snapshot.sdkStatus,
      sdkSubscribed,
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
    lastSyncResultCode,
    localPlayerId,
    osStatus,
    sdkSubscribed,
    syncInFlight,
  ]);

  useEffect(() => {
    const signature = [
      health.status,
      health.permission,
      health.sdk,
      health.lastSyncResultCode ?? 'none',
      Boolean(health.localPlayerId),
      Boolean(health.backendPlayerId),
      health.backendSubscribed === true,
      health.preferencesEnabled !== false,
      health.pausedUntil ?? 'none',
    ].join('|');
    if (lastObservedHealthRef.current === signature) return;
    lastObservedHealthRef.current = signature;
    recordPushDeliveryTelemetry('push_delivery_health_observed', {
      platform: 'native',
      surface: 'push_delivery_health',
      permission_state: health.permission,
      sdk_status: health.sdk,
      client_health_status: health.status,
      sync_result_code: health.lastSyncResultCode ?? 'none',
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
