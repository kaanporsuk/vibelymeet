/**
 * Push permission for native: expo-notifications is canonical for OS state;
 * OneSignal requestPermission is only used when OS status is undetermined (real system sheet).
 */
import { useState, useEffect, useCallback } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { getOsPushPermissionState, type OsPushPermissionState } from '@/lib/osPushPermission';

let OneSignal: any = null;
try {
  const mod: any = require('react-native-onesignal');
  OneSignal = mod?.OneSignal ?? mod?.default ?? mod ?? null;
} catch {
  OneSignal = null;
}

export type RequestPushPermissionResult = {
  granted: boolean;
  /** System already denied push — never call OneSignal.requestPermission; show branded recovery. */
  osDenied: boolean;
};

export function usePushPermission() {
  const [osStatus, setOsStatus] = useState<OsPushPermissionState | 'unknown'>('unknown');

  const refresh = useCallback(async () => {
    try {
      const next = await getOsPushPermissionState();
      setOsStatus(next);
    } catch {
      setOsStatus('unknown');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') {
        void refresh();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  const requestPermission = useCallback(async (): Promise<RequestPushPermissionResult> => {
    const before = await getOsPushPermissionState();
    if (before === 'denied') {
      await refresh();
      return { granted: false, osDenied: true };
    }
    if (before === 'granted') {
      await refresh();
      return { granted: true, osDenied: false };
    }
    if (!OneSignal?.Notifications) {
      await refresh();
      return { granted: false, osDenied: false };
    }
    try {
      const granted = await OneSignal.Notifications.requestPermission(false);
      await refresh();
      return { granted, osDenied: false };
    } catch {
      await refresh();
      return { granted: false, osDenied: false };
    }
  }, [refresh]);

  const openSettings = useCallback(() => {
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
    /** True when the OS will show the real permission sheet if we call OneSignal.requestPermission */
    canRequestOsPermission,
    isDefault,
    isUnknown,
    requestPermission,
    openSettings,
    refresh,
  };
}
