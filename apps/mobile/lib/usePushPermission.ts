/**
 * Push permission for native: expo-notifications is canonical for OS state and for requesting the system sheet.
 * Backend / OneSignal subscription sync is separate (see syncPushSubscriptionToBackend, syncBackendAfterPushGrant).
 */
import { useState, useEffect, useCallback } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import {
  getStableOsPushPermissionState,
  pushPermDevLog,
  requestOsPushPermission,
  type OsPushPermissionState,
} from '@/lib/osPushPermission';
import { logOneSignalPushDiagnostics } from '@/lib/onesignal';

export type RequestPushPermissionResult = {
  granted: boolean;
  /** System already denied push — never call requestPermissionsAsync again; show branded recovery. */
  osDenied: boolean;
};

type SharedOsStatus = OsPushPermissionState | 'unknown';

type PushPermissionSnapshot = {
  osStatus: SharedOsStatus;
  permissionStateHydrated: boolean;
};

const RECENT_REFRESH_DEDUPE_MS = 500;
const IOS_FOREGROUND_RECONCILE_DELAY_MS = 160;

const listeners = new Set<() => void>();

const store: PushPermissionSnapshot & {
  refreshInFlight: Promise<SharedOsStatus> | null;
  appStateSubscription: { remove: () => void } | null;
  appStateSubscriberCount: number;
  lastRefreshCompletedAt: number;
} = {
  osStatus: 'unknown',
  permissionStateHydrated: false,
  refreshInFlight: null,
  appStateSubscription: null,
  appStateSubscriberCount: 0,
  lastRefreshCompletedAt: 0,
};

function getSnapshot(): PushPermissionSnapshot {
  return {
    osStatus: store.osStatus,
    permissionStateHydrated: store.permissionStateHydrated,
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyOsState(next: OsPushPermissionState, source: string): void {
  const prev = store.osStatus;
  store.osStatus = next;
  store.permissionStateHydrated = true;
  store.lastRefreshCompletedAt = Date.now();
  pushPermDevLog('applyOsState:hydrated', {
    source,
    next,
    prev,
    permissionStateHydrated: true,
  });
  if (Platform.OS === 'ios' && prev === 'denied' && next === 'granted') {
    pushPermDevLog('reconcile: denied -> granted (e.g. return from iOS Settings)');
  }
  emit();
}

function applyTransientUnknown(source: string, e: unknown): void {
  const prev = store.osStatus;
  store.osStatus = 'unknown';
  store.permissionStateHydrated = false;
  store.lastRefreshCompletedAt = Date.now();
  pushPermDevLog('permission_state_transient_unhydrated', {
    source,
    prev,
    permissionStateHydrated: false,
    message: e instanceof Error ? e.message : String(e),
  });
  emit();
}

async function refreshSharedPushPermission(source: string, force = false): Promise<SharedOsStatus> {
  if (store.refreshInFlight) {
    pushPermDevLog('permission_state_refresh_skipped', { source, reason: 'refresh_in_flight' });
    return store.refreshInFlight;
  }

  const ageMs = Date.now() - store.lastRefreshCompletedAt;
  if (!force && store.permissionStateHydrated && ageMs < RECENT_REFRESH_DEDUPE_MS) {
    pushPermDevLog('permission_state_refresh_skipped', {
      source,
      reason: 'recently_hydrated',
      ageMs,
      osStatus: store.osStatus,
    });
    return store.osStatus;
  }

  pushPermDevLog('permission_state_refresh_started', {
    source,
    current: store.osStatus,
    permissionStateHydrated: store.permissionStateHydrated,
  });

  const refreshPromise = (async () => {
    try {
      const next = await getStableOsPushPermissionState(source);
      applyOsState(next, source);
      return next;
    } catch (e) {
      applyTransientUnknown(source, e);
      return 'unknown';
    }
  })().finally(() => {
    store.refreshInFlight = null;
  });

  store.refreshInFlight = refreshPromise;
  return refreshPromise;
}

function retainSingletonAppStateListener(): () => void {
  store.appStateSubscriberCount += 1;
  if (!store.appStateSubscription) {
    pushPermDevLog('permission AppState subscription created');
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      void (async () => {
        pushPermDevLog('AppState -> active: foreground OS permission reconcile (no prompt)');
        if (Platform.OS === 'ios') {
          await new Promise((r) => setTimeout(r, IOS_FOREGROUND_RECONCILE_DELAY_MS));
        }
        await refreshSharedPushPermission('appstate_active');
      })();
    };
    store.appStateSubscription = AppState.addEventListener('change', onChange);
  } else {
    pushPermDevLog('permission AppState subscription reused', {
      subscribers: store.appStateSubscriberCount,
    });
  }

  return () => {
    store.appStateSubscriberCount = Math.max(0, store.appStateSubscriberCount - 1);
    if (store.appStateSubscriberCount === 0 && store.appStateSubscription) {
      store.appStateSubscription.remove();
      store.appStateSubscription = null;
      pushPermDevLog('permission AppState subscription removed');
    }
  };
}

export function usePushPermission() {
  const [snapshot, setSnapshot] = useState<PushPermissionSnapshot>(getSnapshot);

  useEffect(() => subscribe(() => setSnapshot(getSnapshot())), []);

  useEffect(() => {
    const releaseAppStateListener = retainSingletonAppStateListener();
    void refreshSharedPushPermission('hook_mount');
    return releaseAppStateListener;
  }, []);

  const refresh = useCallback(async (source = 'manual_refresh') => {
    await refreshSharedPushPermission(source);
  }, []);

  const requestPermission = useCallback(async (): Promise<RequestPushPermissionResult> => {
    pushPermDevLog('usePushPermission.requestPermission (delegates to requestOsPushPermission)');
    const result = await requestOsPushPermission();
    await refreshSharedPushPermission('request_permission_completed', true);
    await logOneSignalPushDiagnostics('after requestPermission');
    return result;
  }, []);

  const openSettings = useCallback(() => {
    pushPermDevLog('openSettings / recovery path (passive — no OS permission request)');
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  const { osStatus, permissionStateHydrated } = snapshot;
  const isGranted = osStatus === 'granted';
  const isDenied = osStatus === 'denied';
  const canRequestOsPermission = osStatus === 'undetermined';
  /** @deprecated use canRequestOsPermission — undetermined means OS has not been asked yet */
  const isDefault = osStatus === 'undetermined';
  const isUnknown = osStatus === 'unknown';

  return {
    osStatus,
    status: osStatus === 'unknown' ? 'unknown' : osStatus,
    isGranted,
    isDenied,
    permissionStateHydrated,
    /** True when the OS will show the real permission sheet if we call requestOsPushPermission */
    canRequestOsPermission,
    isDefault,
    isUnknown,
    requestPermission,
    openSettings,
    refresh,
  };
}
