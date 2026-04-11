/**
 * Push permission for native: expo-notifications is canonical for OS state and for requesting the system sheet.
 * Backend / OneSignal subscription sync is separate (see syncPushSubscriptionToBackend, syncBackendAfterPushGrant).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import {
  getOsPushPermissionState,
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

export function usePushPermission() {
  const [osStatus, setOsStatus] = useState<OsPushPermissionState | 'unknown'>('unknown');
  const prevOsRef = useRef<OsPushPermissionState | 'unknown'>('unknown');

  const applyOsState = useCallback((next: OsPushPermissionState) => {
    const prev = prevOsRef.current;
    prevOsRef.current = next;
    pushPermDevLog('applyOsState', { next, prev });
    setOsStatus(next);
    if (Platform.OS === 'ios' && prev === 'denied' && next === 'granted') {
      pushPermDevLog('reconcile: denied -> granted (e.g. return from iOS Settings)');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getOsPushPermissionState();
      applyOsState(next);
    } catch {
      setOsStatus('unknown');
    }
  }, [applyOsState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      void (async () => {
        pushPermDevLog('AppState -> active: foreground OS permission reconcile (no prompt)');
        if (Platform.OS === 'ios') {
          await new Promise((r) => setTimeout(r, 160));
        }
        try {
          const nextState = await getOsPushPermissionState();
          applyOsState(nextState);
        } catch {
          setOsStatus('unknown');
        }
      })();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [applyOsState]);

  const requestPermission = useCallback(async (): Promise<RequestPushPermissionResult> => {
    pushPermDevLog('usePushPermission.requestPermission (delegates to requestOsPushPermission)');
    const result = await requestOsPushPermission();
    await refresh();
    await logOneSignalPushDiagnostics('after requestPermission');
    return result;
  }, [refresh]);

  const openSettings = useCallback(() => {
    pushPermDevLog('openSettings / recovery path (passive — no OS permission request)');
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

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
    /** True when the OS will show the real permission sheet if we call requestOsPushPermission */
    canRequestOsPermission,
    isDefault,
    isUnknown,
    requestPermission,
    openSettings,
    refresh,
  };
}
