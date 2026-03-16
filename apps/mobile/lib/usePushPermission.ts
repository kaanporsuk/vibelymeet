/**
 * Push permission state for native — OneSignal-based. Used by NotificationPermissionFlow and Settings.
 * Does not replace OneSignal; exposes permission status and request + open settings.
 */
import { useState, useEffect, useCallback } from 'react';
import { Linking, Platform } from 'react-native';

type PermissionStatus = 'default' | 'granted' | 'denied' | 'unknown';

let OneSignalModule: typeof import('react-native-onesignal') | null = null;
try {
  OneSignalModule = require('react-native-onesignal');
} catch {
  // OneSignal not available (e.g. web)
}

export function usePushPermission() {
  const [status, setStatus] = useState<PermissionStatus>('unknown');

  const refresh = useCallback(async () => {
    if (!OneSignalModule?.OneSignal) {
      setStatus('unknown');
      return;
    }
    try {
      const permission = await OneSignalModule.OneSignal.Notifications.getPermissionAsync();
      setStatus(permission ? 'granted' : 'denied');
    } catch {
      setStatus('unknown');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!OneSignalModule?.OneSignal) return false;
    try {
      const granted = await OneSignalModule.OneSignal.Notifications.requestPermission(false);
      await refresh();
      return granted;
    } catch {
      await refresh();
      return false;
    }
  }, [refresh]);

  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  return {
    status,
    isGranted: status === 'granted',
    isDenied: status === 'denied',
    isUnknown: status === 'unknown',
    requestPermission,
    openSettings,
    refresh,
  };
}
