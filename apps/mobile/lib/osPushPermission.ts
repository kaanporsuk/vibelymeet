/**
 * Canonical OS-level push permission (expo-notifications).
 * Do not use OneSignal.requestPermission for OS state — it does not distinguish undetermined vs denied reliably.
 */
import * as Notifications from 'expo-notifications';
import { PermissionStatus } from 'expo-modules-core';

export type OsPushPermissionState = 'undetermined' | 'granted' | 'denied';

export type OsPushRequestResult = {
  granted: boolean;
  /** System already denied push — never call requestPermissionsAsync again; use open settings / recovery. */
  osDenied: boolean;
};

export function pushPermDevLog(message: string, extra?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (extra) {
    console.log(`[Vibely][push][os] ${message}`, extra);
  } else {
    console.log(`[Vibely][push][os] ${message}`);
  }
}

export async function getOsPushPermissionState(): Promise<OsPushPermissionState> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === PermissionStatus.GRANTED) return 'granted';
    if (status === PermissionStatus.DENIED) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/**
 * Single OS permission request path: expo-notifications only (no OneSignal.requestPermission).
 * Does not sync OneSignal or the backend — call sync helpers after grant if needed.
 */
export async function requestOsPushPermission(): Promise<OsPushRequestResult> {
  const before = await getOsPushPermissionState();
  pushPermDevLog('requestOsPushPermission:before', { before });
  if (before === 'denied') {
    return { granted: false, osDenied: true };
  }
  if (before === 'granted') {
    return { granted: true, osDenied: false };
  }

  pushPermDevLog('requestOsPushPermission:calling Notifications.requestPermissionsAsync');
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    pushPermDevLog('requestOsPushPermission:after', { status });
    return {
      granted: status === PermissionStatus.GRANTED,
      osDenied: status === PermissionStatus.DENIED,
    };
  } catch (e) {
    pushPermDevLog('requestOsPushPermission:error', { message: e instanceof Error ? e.message : String(e) });
    return { granted: false, osDenied: false };
  }
}
