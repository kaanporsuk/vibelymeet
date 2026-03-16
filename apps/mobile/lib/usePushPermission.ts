/**
 * Push permission state for native — OneSignal-based. Used by NotificationPermissionFlow and Settings.
 * Does not replace OneSignal; exposes permission status and request + open settings.
 */
import { useState, useEffect, useCallback } from 'react';
import { Linking, Platform } from 'react-native';

type PermissionStatus = 'default' | 'granted' | 'denied' | 'unknown';

let OneSignal: any = null;
try {
  const mod: any = require('react-native-onesignal');
  OneSignal = mod?.OneSignal ?? mod?.default ?? mod ?? null;
} catch {
  OneSignal = null;
}

export function usePushPermission() {
  const [status, setStatus] = useState<PermissionStatus>('unknown');

  const refresh = useCallback(async () => {
    if (!OneSignal?.Notifications) {
      setStatus('unknown');
      return;
    }
    try {
      const permission = await OneSignal.Notifications.getPermissionAsync();
      setStatus(permission ? 'granted' : 'denied');
    } catch {
      setStatus('unknown');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!OneSignal?.Notifications) return false;
    try {
      const granted = await OneSignal.Notifications.requestPermission(false);
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
